// src/lib/mpf/backtester.ts — Dual-track backtest simulation engine
// Replays the debate rebalancer against 2018-2025 historical data.
// Track 1: Quant-only (1 call/week). Track 2: Quant + News (4 calls/week).
// Budget-limited sessions with interleaved execution.

import { createAdminClient } from "@/lib/supabase/admin";
import { computeAllMetrics } from "./metrics";
import {
  runQuantAgentOnly,
  callGateway,
  parseJSON,
  buildSharedConstraints,
  type PortfolioProposal,
} from "./rebalancer";
import { INVESTMENT_PROFILE, INVESTMENT_PROFILES, AIA_FUNDS, FUND_EXPENSE_RATIOS } from "./constants";
import type { BacktestRun } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BacktestSessionResult {
  track1_cursor: string;
  track2_cursor: string;
  weeks_processed: number;
  budget_used: number;
  budget_remaining: number;
  track1_cumulative_return: number;
  track2_cumulative_return: number;
}

interface SimulationWeekResult {
  allocation: { code: string; weight: number }[];
  rebalanced: boolean;
  debateLog: string;
  budgetCost: number;
}

type PriceMap = Map<string, { date: string; nav: number }[]>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_BUDGET = 20;
const REBALANCE_INTERVAL_WEEKS = 4; // monthly
const METRIC_DRIFT_THRESHOLD = 0.10; // 10%
const TRACK1_COST = 1;
const TRACK2_COST = 4;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Slice all fund prices up to (inclusive) a simulation date.
 * This enforces point-in-time: no future data leaks into metric calculations.
 */
function slicePricesUpToDate(
  allPrices: PriceMap,
  simDate: string
): PriceMap {
  const result: PriceMap = new Map();
  for (const [code, prices] of allPrices) {
    // prices are sorted ascending by date — binary-ish filter
    const sliced = prices.filter((p) => p.date <= simDate);
    if (sliced.length > 0) {
      result.set(code, sliced);
    }
  }
  return result;
}

/**
 * Compute weighted weekly return from actual price movements.
 * Returns decimal fraction (0.01 = 1%).
 */
function computeWeeklyReturn(
  allocation: { code: string; weight: number }[],
  allPrices: PriceMap,
  weekStart: string,
  weekEnd: string
): number {
  let totalReturn = 0;

  for (const { code, weight } of allocation) {
    if (weight === 0) continue;
    const prices = allPrices.get(code);
    if (!prices || prices.length === 0) continue;

    // Find closest price on or before weekStart and weekEnd
    const startNav = findClosestNav(prices, weekStart);
    const endNav = findClosestNav(prices, weekEnd);

    if (startNav === null || endNav === null || startNav === 0) {
      console.log(`[backtester] ${code}: no NAV found (start=${startNav}, end=${endNav}, weekStart=${weekStart}, weekEnd=${weekEnd}, priceCount=${prices.length}, firstDate=${prices[0]?.date}, lastDate=${prices[prices.length-1]?.date})`);
      continue;
    }

    const fundReturn = (endNav - startNav) / startNav;
    if (totalReturn === 0 && fundReturn !== 0) {
      console.log(`[backtester] First non-zero return: ${code} ${weekStart}→${weekEnd}: startNav=${startNav}, endNav=${endNav}, return=${(fundReturn*100).toFixed(4)}%`);
    }
    totalReturn += fundReturn * (weight / 100);
  }

  return totalReturn;
}

/**
 * Find the NAV on or closest before a target date.
 */
function findClosestNav(
  prices: { date: string; nav: number }[],
  targetDate: string
): number | null {
  // prices sorted ascending — walk backward from end
  let best: number | null = null;
  for (let i = prices.length - 1; i >= 0; i--) {
    if (prices[i].date <= targetDate) {
      best = prices[i].nav;
      break;
    }
  }
  return best;
}

/**
 * Add 7 days to a date string (YYYY-MM-DD).
 */
function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

/**
 * Get initial allocation: equal-weight across 3 lowest-fee equity funds.
 */
function getInitialAllocation(): { code: string; weight: number }[] {
  const equityFunds = AIA_FUNDS.filter((f) => f.category === "equity");
  const sorted = equityFunds
    .map((f) => ({ code: f.fund_code, fer: FUND_EXPENSE_RATIOS[f.fund_code] ?? 99 }))
    .sort((a, b) => a.fer - b.fer);

  const top3 = sorted.slice(0, 3);
  // Equal weight in 10% increments: 30% + 30% + 40% (closest to 33.3% each)
  return [
    { code: top3[0].code, weight: 40 },
    { code: top3[1].code, weight: 30 },
    { code: top3[2].code, weight: 30 },
  ];
}

// ---------------------------------------------------------------------------
// Previous metrics cache for drift detection
// ---------------------------------------------------------------------------

let previousMetricsCache: Map<string, Record<string, number | null>> = new Map();

/**
 * Check if any fund's key metrics drifted >10% from previous computation.
 */
function checkMetricsDrift(
  currentMetrics: Map<string, ReturnType<typeof computeAllMetrics>>
): boolean {
  if (previousMetricsCache.size === 0) return false;

  for (const [code, current] of currentMetrics) {
    const prev = previousMetricsCache.get(code);
    if (!prev) continue;

    // Check Sharpe, Sortino, momentum for drift
    const checks: [string, number | null, number | null][] = [
      ["sharpe", current.sharpe_ratio, prev.sharpe_ratio as number | null],
      ["sortino", current.sortino_ratio, prev.sortino_ratio as number | null],
      ["momentum", current.momentum_score, prev.momentum_score as number | null],
    ];

    for (const [, curr, prv] of checks) {
      if (curr === null || prv === null || prv === 0) continue;
      const drift = Math.abs((curr - prv) / prv);
      if (drift > METRIC_DRIFT_THRESHOLD) return true;
    }
  }

  return false;
}

/**
 * Store current metrics in cache for next drift check.
 */
function updateMetricsCache(
  currentMetrics: Map<string, ReturnType<typeof computeAllMetrics>>
): void {
  previousMetricsCache = new Map();
  for (const [code, m] of currentMetrics) {
    previousMetricsCache.set(code, {
      sharpe_ratio: m.sharpe_ratio,
      sortino_ratio: m.sortino_ratio,
      momentum_score: m.momentum_score,
    });
  }
}

// ---------------------------------------------------------------------------
// Historical news via Brave Search API
// ---------------------------------------------------------------------------

/**
 * Fetch reconstructed historical news for Track 2.
 * Uses Brave Search API directly (no MCP — serverless can't use MCP).
 * All results are tagged confidence: "degraded" (look-ahead bias).
 */
async function fetchHistoricalNews(simDate: string): Promise<string> {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) return "[No Brave Search API key — news unavailable]";

  const d = new Date(simDate + "T00:00:00Z");
  const month = d.toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  const year = d.getUTCFullYear();

  const queries = [
    `Hong Kong stock market ${month} ${year}`,
    `Asia economy ${month} ${year}`,
    `Federal Reserve rates ${month} ${year}`,
  ];

  const results: string[] = [];

  for (const query of queries) {
    try {
      const res = await fetch(
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=3`,
        {
          headers: { "X-Subscription-Token": key, Accept: "application/json" },
          signal: AbortSignal.timeout(10000),
        }
      );

      if (!res.ok) continue;

      const data = await res.json();
      const webResults = data.web?.results || [];
      for (const r of webResults) {
        if (r.description) {
          results.push(`[${query}] ${r.title}: ${r.description}`);
        }
      }
    } catch {
      // Non-fatal — degrade gracefully
    }
  }

  if (results.length === 0) {
    return "[No historical news results found — confidence: degraded]";
  }

  return (
    "RECONSTRUCTED HISTORICAL NEWS (confidence: DEGRADED — results may reflect hindsight bias):\n" +
    results.join("\n")
  );
}

// ---------------------------------------------------------------------------
// Simulate one week for one track
// ---------------------------------------------------------------------------

async function simulateWeek(
  track: "quant_only" | "quant_news",
  allPrices: PriceMap,
  previousAllocation: { code: string; weight: number }[],
  weeksSinceLastRebalance: number,
  simDate: string
): Promise<SimulationWeekResult> {
  // 1. Slice prices up to sim date (point-in-time)
  const pointInTimePrices = slicePricesUpToDate(allPrices, simDate);

  // 2. Compute metrics for each fund (3y window)
  const metricsMap = new Map<string, ReturnType<typeof computeAllMetrics>>();
  const metricsLines: string[] = [];

  for (const fund of AIA_FUNDS) {
    const prices = pointInTimePrices.get(fund.fund_code);
    if (!prices || prices.length < 20) continue;

    const m = computeAllMetrics(prices, fund.fund_code, "3y");
    metricsMap.set(fund.fund_code, m);

    metricsLines.push(
      `${fund.fund_code}: Sortino=${m.sortino_ratio?.toFixed(2) ?? "N/A"}, ` +
        `Sharpe=${m.sharpe_ratio?.toFixed(2) ?? "N/A"}, ` +
        `MaxDD=${m.max_drawdown_pct !== null ? (m.max_drawdown_pct * 100).toFixed(1) + "%" : "N/A"}, ` +
        `CAGR=${m.annualized_return_pct !== null ? (m.annualized_return_pct * 100).toFixed(1) + "%" : "N/A"}, ` +
        `FER=${m.expense_ratio_pct?.toFixed(2) ?? "N/A"}%, ` +
        `Mom3M=${m.momentum_score !== null ? (m.momentum_score * 100).toFixed(1) + "%" : "N/A"}`
    );
  }

  const metricsText = metricsLines.join("\n");

  // 3. Check rebalance trigger
  const driftTriggered = checkMetricsDrift(metricsMap);
  const intervalTriggered = weeksSinceLastRebalance >= REBALANCE_INTERVAL_WEEKS;
  const shouldRebalance = intervalTriggered || driftTriggered;

  // Update cache for next drift check
  updateMetricsCache(metricsMap);

  // 4. If no rebalance, carry forward
  if (!shouldRebalance) {
    return {
      allocation: previousAllocation,
      rebalanced: false,
      debateLog: `[${simDate}] No rebalance — weeks since last: ${weeksSinceLastRebalance}, drift: ${driftTriggered}`,
      budgetCost: 0,
    };
  }

  // 5. Build prompts
  const currentPortfolioText = previousAllocation
    .map((a) => `${a.code}: ${a.weight}%`)
    .join("\n");
  const profileText = `Profile: ${INVESTMENT_PROFILE.label}, equity target ${INVESTMENT_PROFILE.equity_pct}%`;
  const availableFunds = AIA_FUNDS.map(
    (f) => `${f.fund_code} (${f.name_en})`
  ).join(", ");
  const sharedConstraints = buildSharedConstraints(availableFunds);

  // 6. Run appropriate pipeline
  let proposal: PortfolioProposal | null = null;
  let debateLog = "";
  let budgetCost = 0;

  if (track === "quant_only") {
    // Track 1: quant agent only (1 call)
    proposal = await runQuantAgentOnly(
      metricsText,
      currentPortfolioText,
      profileText,
      sharedConstraints
    );
    budgetCost = TRACK1_COST;
    debateLog = `[${simDate}] Track 1 (Quant Only)\nMetrics:\n${metricsText}\nProposal: ${JSON.stringify(proposal)}`;
  } else {
    // Track 2: full 4-call debate with historical news
    const newsText = await fetchHistoricalNews(simDate);

    // Step 1: Parallel proposals
    const [quantProposal, newsRaw] = await Promise.all([
      runQuantAgentOnly(metricsText, currentPortfolioText, profileText, sharedConstraints),
      callGateway(
        "You are a market analyst for an MPF pension fund. Propose a 3-fund portfolio based on current market conditions and recent news sentiment. Ignore quantitative metrics — focus on macro trends and risk events.",
        `${profileText}\n\nCURRENT PORTFOLIO:\n${currentPortfolioText}\n\nRECENT NEWS:\n${newsText}\n\n${sharedConstraints}`
      ),
    ]);

    const newsProposal = parseJSON<PortfolioProposal>(newsRaw);

    if (!quantProposal || !newsProposal) {
      // Fallback: carry forward if parse fails
      return {
        allocation: previousAllocation,
        rebalanced: false,
        debateLog: `[${simDate}] Track 2 — failed to parse proposals, carrying forward`,
        budgetCost: 2, // still spent 2 calls
      };
    }

    // Step 2: Debate
    const debateRaw = await callGateway(
      "You are a senior portfolio analyst reviewing two independent proposals for a pension fund. Identify where they agree, where they conflict, and for each conflict argue which position is stronger and why. Be decisive — don't hedge. If one agent is clearly wrong, say so.",
      `QUANT AGENT PROPOSAL:\n${JSON.stringify(quantProposal, null, 2)}\n\nNEWS AGENT PROPOSAL:\n${JSON.stringify(newsProposal, null, 2)}\n\nReturn JSON: { "agreements": ["..."], "conflicts": [{ "topic": "...", "quantPosition": "...", "newsPosition": "...", "verdict": "quant|news", "reasoning": "..." }], "recommendation": "1-2 sentence recommendation" }`
    );

    const debate = parseJSON<{
      agreements: string[];
      conflicts: { topic: string; quantPosition: string; newsPosition: string; verdict: string; reasoning: string }[];
      recommendation: string;
    }>(debateRaw);

    if (!debate) {
      // Step 2 failed — use quant proposal directly
      proposal = quantProposal;
      budgetCost = 3;
      debateLog = `[${simDate}] Track 2 — debate parse failed, using quant proposal\n${newsText}`;
    } else {
      // Step 3: Mediator
      const mediatorRaw = await callGateway(
        `You are the chief investment officer making the final portfolio allocation. Produce the consensus 3-fund portfolio based on the debate below. ${sharedConstraints}\n\nReturn JSON: { "funds": [{ "code": "AIA-XXX", "weight": 50 }], "summary": "decision rationale", "debate_log": "brief summary" }`,
        `QUANT PROPOSAL:\n${JSON.stringify(quantProposal, null, 2)}\n\nNEWS PROPOSAL:\n${JSON.stringify(newsProposal, null, 2)}\n\nDEBATE:\n${JSON.stringify(debate, null, 2)}\n\nFUND METRICS:\n${metricsText}\n\nNEWS CONTEXT:\n${newsText}`
      );

      const mediator = parseJSON<{
        funds: { code: string; weight: number }[];
        summary: string;
        debate_log: string;
      }>(mediatorRaw);

      if (mediator?.funds) {
        proposal = {
          funds: mediator.funds.map((f) => ({
            code: f.code,
            weight: f.weight,
            reasoning: mediator.summary || "",
          })),
          summary: mediator.summary || "",
        };
      } else {
        proposal = quantProposal;
      }

      budgetCost = TRACK2_COST;
      debateLog = [
        `[${simDate}] Track 2 (Quant + News)`,
        `News: ${newsText.slice(0, 500)}`,
        `Quant: ${JSON.stringify(quantProposal)}`,
        `News Agent: ${JSON.stringify(newsProposal)}`,
        `Debate: ${JSON.stringify(debate)}`,
        `Final: ${JSON.stringify(proposal)}`,
      ].join("\n");
    }
  }

  // 7. Validate and normalize proposal
  if (!proposal || !proposal.funds || proposal.funds.length === 0) {
    return {
      allocation: previousAllocation,
      rebalanced: false,
      debateLog: `[${simDate}] No valid proposal — carry forward`,
      budgetCost,
    };
  }

  let finalAllocation = proposal.funds.map((f) => ({
    code: f.code,
    weight: f.weight,
  }));

  // Truncate to 3
  if (finalAllocation.length > 3) {
    finalAllocation = finalAllocation
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 3);
  }

  // Pad to 3 if fewer
  if (finalAllocation.length < 3) {
    const usedCodes = new Set(finalAllocation.map((f) => f.code));
    const fillers = ["AIA-CON", "AIA-ABF", "AIA-GBF"].filter(
      (c) => !usedCodes.has(c)
    );
    while (finalAllocation.length < 3 && fillers.length > 0) {
      finalAllocation.push({ code: fillers.shift()!, weight: 0 });
    }
  }

  // Normalize weights to 10% increments totalling 100%
  const rawTotal = finalAllocation.reduce((s, f) => s + f.weight, 0);
  if (rawTotal !== 100) {
    finalAllocation = finalAllocation.map((f) => ({
      ...f,
      weight: Math.round((f.weight / (rawTotal || 1)) * 10) * 10,
    }));
    const scaledTotal = finalAllocation.reduce((s, f) => s + f.weight, 0);
    if (scaledTotal !== 100) {
      finalAllocation[0].weight += 100 - scaledTotal;
    }
  }

  // Validate 10% increments
  for (const f of finalAllocation) {
    if (f.weight < 0) f.weight = 0;
    if (f.weight > 100) f.weight = 100;
    f.weight = Math.round(f.weight / 10) * 10;
  }
  const finalTotal = finalAllocation.reduce((s, f) => s + f.weight, 0);
  if (finalTotal !== 100) {
    finalAllocation[0].weight += 100 - finalTotal;
  }

  return {
    allocation: finalAllocation,
    rebalanced: true,
    debateLog,
    budgetCost,
  };
}

// ---------------------------------------------------------------------------
// Initialize backtest runs
// ---------------------------------------------------------------------------

/**
 * Create two backtest run rows (one per track) if they don't exist yet.
 */
export async function initBacktestRuns(
  startDate: string,
  endDate: string
): Promise<void> {
  const supabase = createAdminClient();

  const { data: existing, error: existingError } = await supabase
    .from("mpf_backtest_runs")
    .select("id, track")
    .in("status", ["in_progress", "paused"]);
  if (existingError) console.error("[backtester] Failed to fetch existing runs:", existingError);

  const existingTracks = new Set((existing || []).map((r) => r.track));

  for (const track of ["quant_only", "quant_news"] as const) {
    if (existingTracks.has(track)) continue;

    const { error: insertRunError } = await supabase.from("mpf_backtest_runs").insert({
      track,
      cursor_date: startDate,
      start_date: startDate,
      end_date: endDate,
      status: "in_progress",
      total_weeks_processed: 0,
      budget_limit: DEFAULT_BUDGET,
      budget_used_this_session: 0,
      cumulative_return_pct: 0,
    });
    if (insertRunError) console.error("[backtester] Failed to insert backtest run:", track, insertRunError);
  }
}

// ---------------------------------------------------------------------------
// Main session entry point
// ---------------------------------------------------------------------------

/**
 * Run a backtest session: interleave Track 1 and Track 2 up to budget limit.
 * Pre-loads all prices once, then iterates week by week.
 */
export async function runBacktestSession(
  budgetLimit: number = DEFAULT_BUDGET
): Promise<BacktestSessionResult> {
  const supabase = createAdminClient();

  // 1. Load both runs
  const { data: runs, error: runsError } = await supabase
    .from("mpf_backtest_runs")
    .select("*")
    .eq("status", "in_progress")
    .order("track");

  console.log(`[backtester] Loaded runs: ${runs?.length || 0}, error: ${runsError?.message || "none"}`);

  if (!runs || runs.length === 0) {
    // Try without status filter to debug
    const { data: allRuns, error: allRunsError } = await supabase.from("mpf_backtest_runs").select("id, track, status");
    if (allRunsError) console.error("[backtester] Failed to fetch all runs for debug:", allRunsError);
    console.log(`[backtester] All runs in table: ${JSON.stringify(allRuns)}`);
    throw new Error(`No active backtest runs found. Call initBacktestRuns first. (allRuns: ${allRuns?.length || 0})`);
  }

  const track1Run = runs.find((r) => r.track === "quant_only") as BacktestRun | undefined;
  const track2Run = runs.find((r) => r.track === "quant_news") as BacktestRun | undefined;

  if (!track1Run || !track2Run) {
    throw new Error("Missing one or both backtest tracks.");
  }

  // 2. Reset session budgets
  const { error: resetBudgetError } = await supabase
    .from("mpf_backtest_runs")
    .update({ budget_used_this_session: 0, updated_at: new Date().toISOString() })
    .in("id", [track1Run.id, track2Run.id]);
  if (resetBudgetError) console.error("[backtester] Failed to reset session budgets:", resetBudgetError);

  // 3. Pre-load ALL prices from Supabase
  // Supabase default max is 1000 rows. We use .limit() per page and paginate.
  const allPriceRows: { fund_id: string; date: string; nav: number }[] = [];
  let offset = 0;
  const PAGE_SIZE = 1000; // Match Supabase default max
  while (true) {
    const { data: page, error: pageErr } = await supabase
      .from("mpf_prices")
      .select("fund_id, date, nav")
      .order("date", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)
      .limit(PAGE_SIZE);

    if (pageErr) {
      console.error(`[backtester] Price fetch error at offset ${offset}:`, pageErr.message);
      break;
    }
    if (!page || page.length === 0) break;
    allPriceRows.push(...page);
    offset += page.length;
    if (page.length < PAGE_SIZE) break; // last page
  }

  if (allPriceRows.length === 0) {
    throw new Error("No price data found in mpf_prices.");
  }

  // 4. Build fund_id → fund_code lookup
  const { data: fundsData, error: fundsDataError } = await supabase
    .from("mpf_funds")
    .select("id, fund_code");
  if (fundsDataError) console.error("[backtester] Failed to fetch funds data:", fundsDataError);

  const fundIdToCode = new Map(
    (fundsData || []).map((f) => [f.id, f.fund_code])
  );

  // 5. Build PriceMap: fund_code → sorted prices[]
  const allPrices: PriceMap = new Map();
  for (const row of allPriceRows) {
    const code = fundIdToCode.get(row.fund_id);
    if (!code) continue;
    if (!allPrices.has(code)) allPrices.set(code, []);
    allPrices.get(code)!.push({ date: row.date, nav: Number(row.nav) });
  }

  console.log(
    `[backtester] Loaded ${allPriceRows.length} prices for ${allPrices.size} funds`
  );

  // Sanity check: if we loaded fewer than 10K prices, something is wrong
  if (allPriceRows.length < 10000) {
    throw new Error(`Price loading seems truncated: only ${allPriceRows.length} rows loaded for ${allPrices.size} funds. Expected 140K+. Check Supabase grants/RLS.`);
  }

  // Debug: log first fund's price range
  const sampleFund = allPrices.entries().next().value;
  if (sampleFund) {
    const [sCode, sPrices] = sampleFund;
    console.log(`[backtester] Sample: ${sCode} has ${sPrices.length} prices, ${sPrices[0]?.date} → ${sPrices[sPrices.length-1]?.date}`);
  }

  // 6. Track state
  let budgetUsed = 0;
  let weeksProcessed = 0;

  const state: Record<
    string,
    {
      run: BacktestRun;
      cursor: string;
      cumReturn: number;
      allocation: { code: string; weight: number }[];
      weeksSinceRebalance: number;
      completed: boolean;
    }
  > = {
    quant_only: {
      run: track1Run,
      cursor: track1Run.cursor_date,
      cumReturn: track1Run.cumulative_return_pct / 100, // stored as pct, work in decimal
      allocation: [],
      weeksSinceRebalance: 0,
      completed: track1Run.cursor_date > track1Run.end_date,
    },
    quant_news: {
      run: track2Run,
      cursor: track2Run.cursor_date,
      cumReturn: track2Run.cumulative_return_pct / 100,
      allocation: [],
      weeksSinceRebalance: 0,
      completed: track2Run.cursor_date > track2Run.end_date,
    },
  };

  // Load last allocation for each track (from most recent backtest result)
  for (const track of ["quant_only", "quant_news"] as const) {
    const { data: lastResult, error: lastResultError } = await supabase
      .from("mpf_backtest_results")
      .select("allocation, sim_date")
      .eq("run_id", state[track].run.id)
      .order("sim_date", { ascending: false })
      .limit(1)
      .single();
    if (lastResultError && lastResultError.code !== "PGRST116") console.error("[backtester] Failed to fetch last result for track:", track, lastResultError);

    if (lastResult?.allocation) {
      state[track].allocation = lastResult.allocation as {
        code: string;
        weight: number;
      }[];
    } else {
      // First run — use initial allocation
      state[track].allocation = getInitialAllocation();
    }

    // Count weeks since last rebalance
    const { data: lastRebalance, error: lastRebalanceError } = await supabase
      .from("mpf_backtest_results")
      .select("sim_date")
      .eq("run_id", state[track].run.id)
      .eq("rebalance_triggered", true)
      .order("sim_date", { ascending: false })
      .limit(1)
      .single();
    if (lastRebalanceError && lastRebalanceError.code !== "PGRST116") console.error("[backtester] Failed to fetch last rebalance for track:", track, lastRebalanceError);

    if (lastRebalance) {
      const daysSince =
        (new Date(state[track].cursor).getTime() -
          new Date(lastRebalance.sim_date).getTime()) /
        (1000 * 60 * 60 * 24);
      state[track].weeksSinceRebalance = Math.floor(daysSince / 7);
    }
  }

  // 7. Main loop: interleave tracks, respect budget
  // Reset metrics cache at session start
  previousMetricsCache = new Map();

  while (budgetUsed < budgetLimit) {
    // Pick the track that's behind (earlier cursor), prefer Track 1 if tied
    let pickTrack: "quant_only" | "quant_news";

    const t1Done = state.quant_only.completed;
    const t2Done = state.quant_news.completed;

    if (t1Done && t2Done) break;
    if (t1Done) {
      pickTrack = "quant_news";
    } else if (t2Done) {
      pickTrack = "quant_only";
    } else if (state.quant_only.cursor <= state.quant_news.cursor) {
      pickTrack = "quant_only";
    } else {
      pickTrack = "quant_news";
    }

    // Check budget allows this track
    const cost = pickTrack === "quant_only" ? TRACK1_COST : TRACK2_COST;
    if (budgetUsed + cost > budgetLimit) {
      // Try the other track if cheaper
      const otherTrack =
        pickTrack === "quant_only" ? "quant_news" : "quant_only";
      const otherCost =
        otherTrack === "quant_only" ? TRACK1_COST : TRACK2_COST;
      if (
        !state[otherTrack].completed &&
        budgetUsed + otherCost <= budgetLimit
      ) {
        pickTrack = otherTrack as "quant_only" | "quant_news";
      } else {
        break; // can't afford either
      }
    }

    const s = state[pickTrack];
    const simDate = s.cursor;

    // Simulate this week
    const result = await simulateWeek(
      pickTrack,
      allPrices,
      s.allocation,
      s.weeksSinceRebalance,
      simDate
    );

    // Compute weekly return (using actual prices for the coming week)
    const weekEnd = addDays(simDate, 7);
    const weeklyReturn = computeWeeklyReturn(
      result.allocation,
      allPrices,
      simDate,
      weekEnd
    );

    // Update cumulative return (multiplicative)
    s.cumReturn = (1 + s.cumReturn) * (1 + weeklyReturn) - 1;

    // Record result in DB
    const { error: insertResultError } = await supabase.from("mpf_backtest_results").insert({
      run_id: s.run.id,
      sim_date: simDate,
      allocation: result.allocation,
      debate_log: result.debateLog,
      confidence: pickTrack === "quant_news" ? "degraded" : "full",
      weekly_return_pct: weeklyReturn * 100,
      cumulative_return_pct: s.cumReturn * 100,
      rebalance_triggered: result.rebalanced,
    });
    if (insertResultError) console.error("[backtester] Failed to insert backtest result:", simDate, insertResultError);

    // Update tracking
    budgetUsed += result.budgetCost;
    weeksProcessed++;
    s.allocation = result.allocation;
    s.cursor = weekEnd;
    s.weeksSinceRebalance = result.rebalanced ? 0 : s.weeksSinceRebalance + 1;

    // Advance cursor in DB
    const isCompleted = s.cursor > s.run.end_date;
    const { error: updateRunError } = await supabase
      .from("mpf_backtest_runs")
      .update({
        cursor_date: s.cursor,
        cumulative_return_pct: s.cumReturn * 100,
        total_weeks_processed: s.run.total_weeks_processed + 1,
        budget_used_this_session: (s.run.budget_used_this_session || 0) + result.budgetCost,
        status: isCompleted ? "completed" : "in_progress",
        updated_at: new Date().toISOString(),
      })
      .eq("id", s.run.id);
    if (updateRunError) console.error("[backtester] Failed to update run cursor:", s.run.id, updateRunError);

    // Update local run state
    s.run.total_weeks_processed++;
    s.run.budget_used_this_session += result.budgetCost;
    if (isCompleted) s.completed = true;

    console.log(
      `[backtester] ${pickTrack} week ${simDate}: return=${(weeklyReturn * 100).toFixed(2)}%, ` +
        `cum=${(s.cumReturn * 100).toFixed(2)}%, rebalanced=${result.rebalanced}, cost=${result.budgetCost}`
    );
  }

  return {
    track1_cursor: state.quant_only.cursor,
    track2_cursor: state.quant_news.cursor,
    weeks_processed: weeksProcessed,
    budget_used: budgetUsed,
    budget_remaining: budgetLimit - budgetUsed,
    track1_cumulative_return: Number((state.quant_only.cumReturn * 100).toFixed(2)),
    track2_cumulative_return: Number((state.quant_news.cumReturn * 100).toFixed(2)),
  };
}
