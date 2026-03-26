// src/lib/mpf/rebalancer.ts — Dual-Agent Debate Rebalancer
// 4-call pipeline: Quant (parallel) + News (parallel) → Debate → Mediator
import { createAdminClient } from "@/lib/supabase/admin";
import { INVESTMENT_PROFILE } from "./constants";
import { sendDiscordAlert, COLORS } from "@/lib/discord";

const GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/chat/completions";
const MODEL = "anthropic/claude-sonnet-4.6";
const PER_CALL_TIMEOUT = 30000; // 30s

export interface PortfolioProposal {
  funds: { code: string; weight: number; reasoning: string }[];
  summary: string;
}

interface DebateResult {
  agreements: string[];
  conflicts: { topic: string; quantPosition: string; newsPosition: string; verdict: string; reasoning: string }[];
  recommendation: string;
}

interface MediatorResult {
  funds: { code: string; weight: number }[];
  summary_en: string;
  summary_zh: string;
  debate_log: string;
}

interface RebalanceResult {
  rebalanced: boolean;
  reason: string;
  debate_log?: string;
}

export async function callGateway(systemPrompt: string, userContent: string): Promise<string> {
  const key = process.env.AI_GATEWAY_API_KEY;
  if (!key) throw new Error("No AI_GATEWAY_API_KEY");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PER_CALL_TIMEOUT);

  try {
    const res = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        temperature: 0.3,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    if (!res.ok) throw new Error(`AI Gateway ${res.status}`);

    const data = await res.json();
    return data.choices?.[0]?.message?.content || "";
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

export function parseJSON<T>(raw: string): T | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
}

/**
 * Build the shared constraints text for debate prompts.
 * Exported for reuse by the backtester.
 */
export function buildSharedConstraints(availableFunds: string): string {
  return `
STRICT RULES:
1. Output exactly 3 funds. Duplicates allowed (e.g., all 3 can be the same fund for 100% concentration).
2. Weights: 0-100% in 10% increments. Total MUST = 100%.
3. Prioritize: (1) capital preservation, (2) long-term compounding. Never chase short-term returns.
4. 100% equity is valid. 100% cash (AIA-CON) is valid. No allocation limits.
Available funds: ${availableFunds}

Return ONLY valid JSON (no markdown):
{ "funds": [{ "code": "AIA-XXX", "weight": 50, "reasoning": "why" }, ...], "summary": "1-2 sentence summary" }`;
}

/**
 * Run only the Quant Agent — used by backtester Track 1 and the full debate pipeline.
 * Returns a PortfolioProposal based purely on metrics.
 */
export async function runQuantAgentOnly(
  metricsText: string,
  currentPortfolioText: string,
  profileText: string,
  sharedConstraints: string
): Promise<PortfolioProposal | null> {
  const raw = await callGateway(
    "You are a quantitative analyst for an MPF pension fund. Propose a 3-fund portfolio based PURELY on the metrics below. Ignore news — focus only on the numbers.",
    `${profileText}\n\nCURRENT PORTFOLIO:\n${currentPortfolioText}\n\nFUND METRICS (3Y):\n${metricsText}\n\n${sharedConstraints}`
  );
  return parseJSON<PortfolioProposal>(raw);
}

/**
 * Check if portfolio needs rebalancing and execute via dual-agent debate.
 * Called after news classification to react to market events.
 *
 * Rules:
 * - Max 1 rebalance/week for normal drift
 * - Max 3 rebalances/day (absolute ceiling)
 * - NO weekly limit for high-impact news (still capped at 3/day)
 */
export async function evaluateAndRebalance(highImpactCount: number): Promise<RebalanceResult> {
  const supabase = createAdminClient();

  // Daily cap: max 3 rebalances per day
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayISO = todayStart.toISOString();
  const { data: todayRebalances } = await supabase
    .from("mpf_insights")
    .select("id")
    .or("type.eq.alert,type.eq.rebalance_debate")
    .or("trigger.eq.portfolio_rebalance,trigger.eq.debate_rebalance")
    .gte("created_at", todayISO);

  const todayCount = todayRebalances?.length || 0;
  console.log(`[debate-rebalancer] Daily cap check: ${todayCount} rebalances today (since ${todayISO}), data: ${JSON.stringify(todayRebalances?.map(r => r.id).slice(0, 3))}`);
  if (todayCount >= 3) {
    return { rebalanced: false, reason: "Daily rebalance cap reached (3/day)" };
  }

  // Weekly rate limit (skip if high-impact news)
  if (highImpactCount === 0) {
    const { data: lastRebalance } = await supabase
      .from("mpf_insights")
      .select("created_at")
      .or("type.eq.alert,type.eq.rebalance_debate")
      .or("trigger.eq.portfolio_rebalance,trigger.eq.debate_rebalance")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (lastRebalance) {
      const daysSince = (Date.now() - new Date(lastRebalance.created_at).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < 7) {
        return { rebalanced: false, reason: `Last rebalance ${daysSince.toFixed(1)} days ago, no high-impact news` };
      }
    }
  }

  // ===== DATA INTEGRITY GATE — refuse to rebalance with incomplete data =====
  const { data: activeFunds } = await supabase
    .from("mpf_funds")
    .select("id, fund_code")
    .eq("is_active", true);

  const totalActive = activeFunds?.length || 0;

  // Check 1: Price freshness — all funds must have prices within 5 business days
  if (totalActive > 0) {
    const fiveBusinessDaysAgo = new Date();
    fiveBusinessDaysAgo.setDate(fiveBusinessDaysAgo.getDate() - 7); // 5 biz days ≈ 7 calendar days
    const cutoff = fiveBusinessDaysAgo.toISOString().split("T")[0];

    const staleFunds: string[] = [];
    for (const f of activeFunds || []) {
      const { data: latestPrice } = await supabase
        .from("mpf_prices")
        .select("date")
        .eq("fund_id", f.id)
        .order("date", { ascending: false })
        .limit(1)
        .single();

      if (!latestPrice || latestPrice.date < cutoff) {
        staleFunds.push(f.fund_code);
      }
    }

    if (staleFunds.length > 0) {
      const msg = `BLOCKED: stale price data for ${staleFunds.join(", ")}. Fix data pipeline before rebalancing.`;
      console.error(`[debate-rebalancer] ${msg}`);
      await sendDiscordAlert({
        title: "🚫 MPF Care — Rebalance Blocked (Stale Data)",
        description: `**${staleFunds.length} funds** have prices older than 5 business days:\n${staleFunds.join(", ")}\n\nRun the price cron or Yahoo Finance backfill to fix.`,
        color: COLORS.red,
      });
      return { rebalanced: false, reason: msg };
    }
  }

  // Check 2: Metrics coverage — 80% of active funds must have 3Y metrics
  const { data: metricsCount } = await supabase
    .from("mpf_fund_metrics")
    .select("fund_code")
    .eq("period", "3y");

  const fundsWithMetrics = metricsCount?.length || 0;
  const coveragePct = totalActive > 0 ? (fundsWithMetrics / totalActive) * 100 : 0;

  if (coveragePct < 80) {
    const msg = `BLOCKED: insufficient metrics coverage (${fundsWithMetrics}/${totalActive} funds = ${coveragePct.toFixed(0)}%). Run metrics cron first.`;
    console.error(`[debate-rebalancer] ${msg}`);
    await sendDiscordAlert({
      title: "🚫 MPF Care — Rebalance Blocked (Missing Metrics)",
      description: `Only **${fundsWithMetrics}/${totalActive}** funds have 3Y metrics (need 80%+).\n\nRun the metrics cron to fix.`,
      color: COLORS.red,
    });
    return { rebalanced: false, reason: msg };
  }

  console.log(`[debate-rebalancer] Data integrity OK: all prices fresh, metrics ${fundsWithMetrics}/${totalActive} (${coveragePct.toFixed(0)}%)`);

  // Gather data for agents
  const { data: portfolio } = await supabase
    .from("mpf_reference_portfolio")
    .select("fund_id, weight, note");

  if (!portfolio?.length) return { rebalanced: false, reason: "No reference portfolio set" };

  const { data: funds } = await supabase
    .from("mpf_funds")
    .select("id, fund_code, name_en, category, risk_rating");

  const fundMap = new Map((funds || []).map(f => [f.id, f]));
  const fundCodeToId = new Map((funds || []).map(f => [f.fund_code, f.id]));

  const currentHoldings = portfolio.map(p => {
    const fund = fundMap.get(p.fund_id);
    return { code: fund?.fund_code || "", name: fund?.name_en || "", weight: p.weight };
  });

  // Get fund metrics
  const { data: metrics } = await supabase
    .from("mpf_fund_metrics")
    .select("*")
    .eq("period", "3y");

  const metricsText = (metrics || []).map(m =>
    `${m.fund_code}: Sortino=${m.sortino_ratio?.toFixed(2) ?? "N/A"}, Sharpe=${m.sharpe_ratio?.toFixed(2) ?? "N/A"}, MaxDD=${m.max_drawdown_pct !== null ? (m.max_drawdown_pct * 100).toFixed(1) + "%" : "N/A"}, CAGR=${m.annualized_return_pct !== null ? (m.annualized_return_pct * 100).toFixed(1) + "%" : "N/A"}, FER=${m.expense_ratio_pct?.toFixed(2) ?? "N/A"}%, Mom3M=${m.momentum_score !== null ? (m.momentum_score * 100).toFixed(1) + "%" : "N/A"}`
  ).join("\n");

  // Get recent news
  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const { data: recentNews } = await supabase
    .from("mpf_news")
    .select("headline, impact_tags, sentiment, region, is_high_impact")
    .gte("published_at", twoDaysAgo)
    .order("published_at", { ascending: false })
    .limit(20);

  const newsText = (recentNews || []).map(n =>
    `[${n.sentiment}/${n.region}${n.is_high_impact ? "/HIGH-IMPACT" : ""}] ${n.headline} (tags: ${n.impact_tags?.join(", ") || "none"})`
  ).join("\n");

  const currentPortfolioText = currentHoldings.map(h => `${h.code} (${h.name}): ${h.weight}%`).join("\n");
  const profileText = `Profile: ${INVESTMENT_PROFILE.label}, equity target ${INVESTMENT_PROFILE.equity_pct}%`;

  const availableFunds = (funds || []).map(f => `${f.fund_code} (${f.name_en})`).join(", ");

  const sharedConstraints = buildSharedConstraints(availableFunds);

  // ===== FEEDBACK INJECTION — last 5 scored decisions for Debate + Mediator =====
  let trackRecordBlock = "";
  const { data: recentScores } = await supabase
    .from("mpf_rebalance_scores")
    .select("reasoning_quality, win_rate, lessons, actual_return_pct, baseline_return_pct, scored_at")
    .not("insight_id", "is", null)
    .order("scored_at", { ascending: false })
    .limit(5);

  if (recentScores && recentScores.length > 0) {
    const overallWinRate = recentScores.filter(s =>
      s.reasoning_quality === "sound" || s.reasoning_quality === "lucky"
    ).length / recentScores.length;

    trackRecordBlock = `\n\nTRACK RECORD (last ${recentScores.length} scored decisions):\n` +
      recentScores.map(s => {
        const delta = (s.actual_return_pct || 0) - (s.baseline_return_pct || 0);
        return `- ${new Date(s.scored_at).toISOString().split("T")[0]}: ${(s.reasoning_quality || "unknown").toUpperCase()} (${delta > 0 ? "+" : ""}${delta.toFixed(1)}% vs baseline)\n  Lesson: "${(s.lessons || [])[0] || "No lesson"}"`;
      }).join("\n") +
      `\n\nOverall win rate: ${(overallWinRate * 100).toFixed(0)}%`;
  }

  // ===== STEP 1: Parallel proposals =====
  const [quantProposal, newsRaw] = await Promise.all([
    runQuantAgentOnly(metricsText, currentPortfolioText, profileText, sharedConstraints),
    callGateway(
      "You are a market analyst for an MPF pension fund. Propose a 3-fund portfolio based on current market conditions and recent news sentiment. Ignore quantitative metrics — focus on macro trends and risk events.",
      `${profileText}\n\nCURRENT PORTFOLIO:\n${currentPortfolioText}\n\nRECENT NEWS (48h):\n${newsText || "No recent news"}\n\n${sharedConstraints}`
    ),
  ]);

  const newsProposal = parseJSON<PortfolioProposal>(newsRaw);

  if (!quantProposal || !newsProposal) {
    return { rebalanced: false, reason: "Failed to parse agent proposals" };
  }

  // ===== STEP 2: Debate =====
  const debateRaw = await callGateway(
    "You are a senior portfolio analyst reviewing two independent proposals for a pension fund. Identify where they agree, where they conflict, and for each conflict argue which position is stronger and why. Be decisive — don't hedge. If one agent is clearly wrong, say so." + trackRecordBlock,
    `QUANT AGENT PROPOSAL:\n${JSON.stringify(quantProposal, null, 2)}\n\nNEWS AGENT PROPOSAL:\n${JSON.stringify(newsProposal, null, 2)}\n\nReturn JSON: { "agreements": ["..."], "conflicts": [{ "topic": "...", "quantPosition": "...", "newsPosition": "...", "verdict": "quant|news", "reasoning": "..." }], "recommendation": "1-2 sentence recommendation" }`
  );

  const debate = parseJSON<DebateResult>(debateRaw);
  if (!debate) {
    return { rebalanced: false, reason: "Failed to parse debate" };
  }

  // ===== STEP 3: Mediator =====
  const mediatorRaw = await callGateway(
    `You are the chief investment officer making the final portfolio allocation. Produce the consensus 3-fund portfolio based on the debate below. ${sharedConstraints}\n\nReturn JSON: { "funds": [{ "code": "AIA-XXX", "weight": 50 }, ...], "summary_en": "plain English summary for the team", "summary_zh": "中文摘要", "debate_log": "Quant said X. News said Y. They agreed on Z. Final decision: ..." }` + trackRecordBlock,
    `QUANT PROPOSAL:\n${JSON.stringify(quantProposal, null, 2)}\n\nNEWS PROPOSAL:\n${JSON.stringify(newsProposal, null, 2)}\n\nDEBATE:\n${JSON.stringify(debate, null, 2)}\n\nFUND METRICS:\n${metricsText}\n\nNEWS SUMMARY:\n${newsText || "No recent news"}`
  );

  const mediator = parseJSON<MediatorResult>(mediatorRaw);
  if (!mediator) {
    return { rebalanced: false, reason: "Failed to parse mediator verdict" };
  }

  // ===== VALIDATION =====
  let newPortfolio = mediator.funds;
  if (!Array.isArray(newPortfolio) || newPortfolio.length < 1) {
    return { rebalanced: false, reason: "Mediator proposed empty portfolio" };
  }

  // Truncate to 3 if needed
  if (newPortfolio.length > 3) {
    newPortfolio = newPortfolio.sort((a, b) => b.weight - a.weight).slice(0, 3);
    const rawTotal = newPortfolio.reduce((s, p) => s + p.weight, 0);
    newPortfolio = newPortfolio.map(p => ({ ...p, weight: Math.round((p.weight / rawTotal) * 10) * 10 }));
    const scaledTotal = newPortfolio.reduce((s, p) => s + p.weight, 0);
    if (scaledTotal !== 100) newPortfolio[0].weight += 100 - scaledTotal;
  }

  // Pad to 3 if fewer
  if (newPortfolio.length < 3) {
    const usedCodes = new Set(newPortfolio.map(p => p.code));
    const fillers = ["AIA-CON", "AIA-ABF", "AIA-GBF"].filter(c => !usedCodes.has(c));
    while (newPortfolio.length < 3 && fillers.length > 0) {
      newPortfolio.push({ code: fillers.shift()!, weight: 0 });
    }
  }

  const totalWeight = newPortfolio.reduce((s, p) => s + p.weight, 0);
  if (totalWeight !== 100) {
    return { rebalanced: false, reason: `Portfolio total ${totalWeight}% (must be 100%)` };
  }

  for (const p of newPortfolio) {
    if (p.weight < 0 || p.weight > 100 || p.weight % 10 !== 0) {
      return { rebalanced: false, reason: `Invalid weight ${p.weight}% for ${p.code}` };
    }
  }

  const activePortfolio = newPortfolio.filter(p => p.weight > 0);
  if (activePortfolio.length === 0) {
    return { rebalanced: false, reason: "All funds at 0%" };
  }

  // ===== APPLY =====
  await supabase.from("mpf_reference_portfolio").delete().neq("fund_id", "00000000-0000-0000-0000-000000000000");

  for (const p of activePortfolio) {
    const fund_id = fundCodeToId.get(p.code);
    if (!fund_id) continue;
    await supabase.from("mpf_reference_portfolio").insert({
      fund_id,
      weight: p.weight,
      note: `Debate consensus`,
      updated_by: "debate-rebalancer",
    });
  }

  // Full debate log
  const fullDebateLog = [
    "## Quant Agent",
    quantProposal.summary,
    quantProposal.funds.map(f => `- ${f.code}: ${f.weight}% — ${f.reasoning}`).join("\n"),
    "",
    "## News Agent",
    newsProposal.summary,
    newsProposal.funds.map(f => `- ${f.code}: ${f.weight}% — ${f.reasoning}`).join("\n"),
    "",
    "## Debate",
    `Agreements: ${debate.agreements.join("; ")}`,
    ...debate.conflicts.map(c => `Conflict: ${c.topic} — Verdict: ${c.verdict} — ${c.reasoning}`),
    "",
    "## Final Decision",
    mediator.debate_log,
  ].join("\n");

  await supabase.from("mpf_insights").insert({
    type: "rebalance_debate",
    trigger: "debate_rebalance",
    content_en: `${mediator.summary_en}\n\n---\n\n${fullDebateLog}`,
    content_zh: mediator.summary_zh,
    fund_categories: [...new Set(activePortfolio.map(p => {
      const fund = funds?.find(f => f.fund_code === p.code);
      return fund?.category || "unknown";
    }))],
    status: "completed",
    model: MODEL,
  });

  // Discord notification for successful rebalance
  const portfolioSummary = activePortfolio.map(p => `${p.code} ${p.weight}%`).join(" / ");
  await sendDiscordAlert({
    title: "📊 MPF Care — Portfolio Rebalanced",
    description: [
      `**New allocation:** ${portfolioSummary}`,
      `**Reason:** ${mediator.summary_en.slice(0, 200)}`,
      "",
      "**Debate summary:**",
      `Agreements: ${debate.agreements.slice(0, 2).join("; ")}`,
      debate.conflicts.length > 0 ? `Conflicts: ${debate.conflicts.map(c => c.topic).join(", ")}` : "No conflicts",
    ].join("\n"),
    color: COLORS.green,
  }).catch(() => {}); // Don't fail rebalance if Discord fails

  return {
    rebalanced: true,
    reason: mediator.summary_en,
    debate_log: fullDebateLog,
  };
}
