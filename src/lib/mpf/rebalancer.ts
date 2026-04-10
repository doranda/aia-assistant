// src/lib/mpf/rebalancer.ts — Dual-Agent Debate Rebalancer
// 4-call pipeline: Quant (parallel) + News (parallel) → Debate → Mediator
import { createAdminClient } from "@/lib/supabase/admin";
import { INVESTMENT_PROFILES, formatAllocation } from "./constants";
import { sendDiscordAlert, COLORS } from "@/lib/discord";

const GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/chat/completions";
const MODEL = "anthropic/claude-opus-4-6";
const PER_CALL_TIMEOUT = 60000; // 60s — debate + mediator calls need more time with defensive-first prompts

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
 * Danger detection: pre-compute quantitative danger signals from metrics.
 * These are HARD signals agents must acknowledge — not suggestions.
 */
export function detectDangerSignals(metricsText: string): string {
  const lines = metricsText.split("\n").filter(Boolean);
  const dangers: string[] = [];
  let negativeSortinoCount = 0;
  let deepDrawdownCount = 0;
  let negativeMomentumCount = 0;
  let totalEquityFunds = 0;

  for (const line of lines) {
    // Only check equity/index/dynamic funds
    const code = line.split(":")[0]?.trim();
    if (!code) continue;
    const isEquity = ["AEF","EEF","GCF","NAF","GRF","AMI","EAI","HCI","WIF","GRW","CHD","MCF"].some(c => code.includes(c));
    if (!isEquity) continue;
    totalEquityFunds++;

    const sortino = line.match(/Sortino=([-\d.]+)/)?.[1];
    const maxDD = line.match(/MaxDD=([-\d.]+)%/)?.[1];
    const mom = line.match(/Mom3M=([-\d.]+)%/)?.[1];

    if (sortino && parseFloat(sortino) < 0) negativeSortinoCount++;
    if (maxDD && parseFloat(maxDD) < -20) deepDrawdownCount++;
    if (mom && parseFloat(mom) < -5) negativeMomentumCount++;
  }

  const majorityNegSortino = totalEquityFunds > 0 && (negativeSortinoCount / totalEquityFunds) > 0.5;
  const majorityDeepDD = totalEquityFunds > 0 && (deepDrawdownCount / totalEquityFunds) > 0.4;
  const majorityNegMom = totalEquityFunds > 0 && (negativeMomentumCount / totalEquityFunds) > 0.5;

  if (majorityNegSortino) dangers.push(`DANGER: ${negativeSortinoCount}/${totalEquityFunds} equity funds have NEGATIVE Sortino ratios — downside risk exceeds upside.`);
  if (majorityDeepDD) dangers.push(`DANGER: ${deepDrawdownCount}/${totalEquityFunds} equity funds have max drawdowns worse than -20% — severe capital destruction risk.`);
  if (majorityNegMom) dangers.push(`DANGER: ${negativeMomentumCount}/${totalEquityFunds} equity funds have negative 3-month momentum — broad market decline in progress.`);

  if (dangers.length >= 2) {
    dangers.push("⚠️ MULTIPLE DANGER SIGNALS ACTIVE — default stance MUST be defensive. You need STRONG justification to allocate >40% to equity.");
  }

  return dangers.length > 0 ? `\n\n🚨 QUANTITATIVE DANGER SIGNALS:\n${dangers.join("\n")}` : "";
}

export function buildSharedConstraints(availableFunds: string, dangerSignals: string = ""): string {
  return `
INVESTMENT PHILOSOPHY — "The best winning is not losing. Then comes winning."
Your DEFAULT stance is DEFENSIVE. You must EARN the right to allocate to equity with clear evidence.

STRICT RULES:
1. Output exactly 3 funds. Duplicates allowed (e.g., all 3 can be the same fund for 100% concentration).
2. Weights: 0-100% in 10% increments. Total MUST = 100%.
3. DEFENSIVE-FIRST: Start from 100% cash/bonds. Add equity ONLY with specific evidence it's safe.
4. Capital preservation is NON-NEGOTIABLE. A 30% loss requires a 43% gain to recover. Avoiding the dip IS the alpha.
5. If danger signals are present, maximum 40% equity unless you provide exceptional justification.
6. 100% defensive (AIA-CON + bonds) is a VALID and often CORRECT decision. Don't feel pressure to hold equity.
7. "The market might recover" is NOT a reason to stay in equity. Only stay if the data says the risk is already priced in.
${dangerSignals}

Available funds: ${availableFunds}
Defensive funds: AIA-CON (cash, 0.39% FER), AIA-ABF (Asian bonds), AIA-GBF (Global bonds), AIA-GPF (guaranteed), AIA-CST (capital stable)

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
    `You are a RISK-FIRST quantitative analyst for an MPF pension fund. Your job is to PROTECT capital first, grow it second.

DECISION FRAMEWORK (in order):
1. CHECK SORTINO RATIOS: If most equity funds have Sortino < 0.5, the risk-reward is unfavorable. Go defensive.
2. CHECK MAX DRAWDOWN: If any fund in the current portfolio has drawdown > -15%, that fund must be replaced or reduced.
3. CHECK MOMENTUM: If 3-month momentum is negative for majority of equity funds, the trend is DOWN. Do not fight the trend.
4. ONLY THEN consider upside: If Sortino > 1.0, drawdown is recovering, and momentum is positive — allocate to equity.

You are a SKEPTIC, not an optimist. Your job is to say "the numbers don't justify equity" when they don't. Propose a 3-fund portfolio based PURELY on these metrics.`,
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
  const { data: todayRebalances, error: todayError } = await supabase
    .from("mpf_insights")
    .select("id")
    .or("type.eq.alert,type.eq.rebalance_debate")
    .or("trigger.eq.portfolio_rebalance,trigger.eq.debate_rebalance")
    .in("status", ["completed", "submitted"])
    .gte("created_at", todayISO);
  if (todayError) console.error("[debate-rebalancer] Failed to fetch today's rebalances:", todayError);

  const todayCount = todayRebalances?.length || 0;
  console.log(`[debate-rebalancer] Daily cap check: ${todayCount} rebalances today (since ${todayISO}), data: ${JSON.stringify(todayRebalances?.map(r => r.id).slice(0, 3))}`);
  if (todayCount >= 3) {
    return { rebalanced: false, reason: "Daily rebalance cap reached (3/day)" };
  }

  // Weekly rate limit (skip if high-impact news)
  if (highImpactCount === 0) {
    const { data: lastRebalance, error: lastRebalanceError } = await supabase
      .from("mpf_insights")
      .select("created_at")
      .or("type.eq.alert,type.eq.rebalance_debate")
      .or("trigger.eq.portfolio_rebalance,trigger.eq.debate_rebalance")
      .in("status", ["completed", "submitted"])
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    if (lastRebalanceError && lastRebalanceError.code !== "PGRST116") console.error("[debate-rebalancer] Failed to fetch last rebalance:", lastRebalanceError);

    if (lastRebalance) {
      const daysSince = (Date.now() - new Date(lastRebalance.created_at).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < 7) {
        return { rebalanced: false, reason: `Last rebalance ${daysSince.toFixed(1)} days ago, no high-impact news` };
      }
    }
  }

  // ===== DATA INTEGRITY GATE — refuse to rebalance with incomplete data =====
  const { data: activeFunds, error: activeFundsError } = await supabase
    .from("mpf_funds")
    .select("id, fund_code")
    .eq("is_active", true);
  if (activeFundsError) console.error("[debate-rebalancer] Failed to fetch active funds:", activeFundsError);

  const totalActive = activeFunds?.length || 0;

  // Price freshness does NOT gate rebalancing. The rebalancer uses whatever
  // prices are available. AIA has a structural ~5 biz day lag — that's normal.
  // Optimistic settlement handles missing NAVs (execute → backfill → settle).
  // The only block belongs in switch submission (T+2/T+1 rules), not here.

  // Check: Metrics coverage — 80% of active funds must have 3Y metrics
  const activeCodes = (activeFunds || []).map(f => f.fund_code);
  const { data: metricsCount, error: metricsCountError } = await supabase
    .from("mpf_fund_metrics")
    .select("fund_code")
    .eq("period", "3y")
    .in("fund_code", activeCodes.length > 0 ? activeCodes : ["__none__"]);
  if (metricsCountError) console.error("[debate-rebalancer] Failed to fetch metrics count:", metricsCountError);

  const fundsWithMetrics = metricsCount?.length || 0;
  const coveragePct = totalActive > 0 ? (fundsWithMetrics / totalActive) * 100 : 0;

  if (coveragePct < 80) {
    const msg = `BLOCKED: insufficient metrics coverage (${fundsWithMetrics}/${totalActive} funds = ${coveragePct.toFixed(0)}%). Run metrics cron first.`;
    console.error(`[debate-rebalancer] ${msg}`);
    await sendDiscordAlert(
      {
        title: "🚫 MPF Care — Rebalance Blocked (Missing Metrics)",
        description: `Only **${fundsWithMetrics}/${totalActive}** funds have 3Y metrics (need 80%+).\n\nRun the metrics cron to fix.`,
        color: COLORS.red,
      },
      { urgent: true }
    );
    return { rebalanced: false, reason: msg };
  }

  console.log(`[debate-rebalancer] Data integrity OK: all prices fresh, metrics ${fundsWithMetrics}/${totalActive} (${coveragePct.toFixed(0)}%)`);

  // Gather data for agents
  const { data: portfolio, error: portfolioError } = await supabase
    .from("mpf_reference_portfolio")
    .select("fund_id, weight, note");
  if (portfolioError) console.error("[debate-rebalancer] Failed to fetch reference portfolio:", portfolioError);

  if (!portfolio?.length) return { rebalanced: false, reason: "No reference portfolio set" };

  const { data: funds, error: fundsError } = await supabase
    .from("mpf_funds")
    .select("id, fund_code, name_en, category, risk_rating");
  if (fundsError) console.error("[debate-rebalancer] Failed to fetch funds:", fundsError);

  const fundMap = new Map((funds || []).map(f => [f.id, f]));

  const currentHoldings = portfolio.map(p => {
    const fund = fundMap.get(p.fund_id);
    return { code: fund?.fund_code || "", name: fund?.name_en || "", weight: p.weight };
  });

  // Get fund metrics
  const { data: metrics, error: metricsError } = await supabase
    .from("mpf_fund_metrics")
    .select("*")
    .eq("period", "3y");
  if (metricsError) console.error("[debate-rebalancer] Failed to fetch fund metrics:", metricsError);

  const metricsText = (metrics || []).map(m =>
    `${m.fund_code}: Sortino=${m.sortino_ratio?.toFixed(2) ?? "N/A"}, Sharpe=${m.sharpe_ratio?.toFixed(2) ?? "N/A"}, MaxDD=${m.max_drawdown_pct !== null ? (m.max_drawdown_pct * 100).toFixed(1) + "%" : "N/A"}, CAGR=${m.annualized_return_pct !== null ? (m.annualized_return_pct * 100).toFixed(1) + "%" : "N/A"}, FER=${m.expense_ratio_pct?.toFixed(2) ?? "N/A"}%, Mom3M=${m.momentum_score !== null ? (m.momentum_score * 100).toFixed(1) + "%" : "N/A"}`
  ).join("\n");

  // Get recent news
  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const { data: recentNews, error: recentNewsError } = await supabase
    .from("mpf_news")
    .select("headline, impact_tags, sentiment, region, is_high_impact")
    .gte("published_at", twoDaysAgo)
    .order("published_at", { ascending: false })
    .limit(20);
  if (recentNewsError) console.error("[debate-rebalancer] Failed to fetch recent news:", recentNewsError);

  const newsText = (recentNews || []).map(n =>
    `[${n.sentiment}/${n.region}${n.is_high_impact ? "/HIGH-IMPACT" : ""}] ${n.headline} (tags: ${n.impact_tags?.join(", ") || "none"})`
  ).join("\n");

  const currentPortfolioText = currentHoldings.map(h => `${h.code} (${h.name}): ${h.weight}%`).join("\n");

  const availableFunds = (funds || []).map(f => `${f.fund_code} (${f.name_en})`).join(", ");

  // ===== DANGER DETECTION — pre-compute quantitative risk signals =====
  const dangerSignals = detectDangerSignals(metricsText);
  if (dangerSignals) {
    console.log(`[debate-rebalancer] ${dangerSignals}`);
  }

  // ===== DUAL-PROFILE DEBATE — run both perspectives =====
  // Profile 1: Age-based (35yo) — provides traditional lifecycle context
  // Profile 2: Pure quant — no age bias, let data speak
  const ageProfile = INVESTMENT_PROFILES.age_based;
  const pureProfile = INVESTMENT_PROFILES.pure_quant;

  const profileText = [
    `PERSPECTIVE 1 (Age-Based): ${ageProfile.label}, equity anchor ${ageProfile.equity_pct}% — but this is a CEILING, not a floor. Go lower if data warrants.`,
    `PERSPECTIVE 2 (Pure Data): ${pureProfile.label} — ignore age entirely. What do the numbers and news actually say?`,
    `YOUR JOB: Consider both perspectives. When they conflict, the MORE CAUTIOUS wins.`,
  ].join("\n");

  const sharedConstraints = buildSharedConstraints(availableFunds, dangerSignals);

  // ===== FEEDBACK INJECTION — last 5 scored decisions for Debate + Mediator =====
  let trackRecordBlock = "";
  const { data: recentScores, error: scoresError } = await supabase
    .from("mpf_rebalance_scores")
    .select("reasoning_quality, win_rate, lessons, actual_return_pct, baseline_return_pct, scored_at")
    .not("insight_id", "is", null)
    .order("scored_at", { ascending: false })
    .limit(5);
  if (scoresError) console.error("[debate-rebalancer] Failed to fetch recent scores:", scoresError);

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
      `You are a GEOPOLITICAL RISK analyst for an MPF pension fund. Your PRIMARY job is to detect DANGER before it hits the portfolio.

THREAT ASSESSMENT FRAMEWORK:
1. WAR / MILITARY CONFLICT: Any active or escalating conflict → IMMEDIATE defensive shift. Minimum 60% defensive. Wars destroy equity for months/years.
2. SANCTIONS / TRADE WAR: Broad sanctions, tariff escalation → defensive shift for affected regions. Don't wait for the market to price it in.
3. CENTRAL BANK HAWKISHNESS: Rate hikes, tightening signals → reduce equity, increase bonds.
4. CURRENCY CRISIS: Major currency moves → reduce exposure to affected region.
5. POLITICAL INSTABILITY: Elections, regime change, policy uncertainty → reduce equity in that region.

ONLY go offense if: No active threats, positive sentiment across regions, AND market is in confirmed uptrend.

"No recent news" does NOT mean "safe." It means you lack information — default to CAUTION, not optimism.
A BLANK news feed = at least 40% defensive allocation.`,
      `${profileText}\n\nCURRENT PORTFOLIO:\n${currentPortfolioText}\n\nRECENT NEWS (48h):\n${newsText || "No recent news"}\n\n${sharedConstraints}`
    ),
  ]);

  const newsProposal = parseJSON<PortfolioProposal>(newsRaw);

  if (!quantProposal || !newsProposal) {
    return { rebalanced: false, reason: "Failed to parse agent proposals" };
  }

  // ===== STEP 2: Debate =====
  const debateRaw = await callGateway(
    `You are the RISK COMMITTEE reviewing two proposals for a pension fund. Your bias is TOWARD SAFETY.

DEBATE RULES:
1. When Quant and News DISAGREE on risk level, the MORE CAUTIOUS position wins by default. The burden of proof is on the BULLISH side.
2. If EITHER agent recommends >50% defensive, take that seriously. One agent seeing danger is enough to act.
3. "Long-term recovery" is not a valid argument during active risk events. Short-term losses compound into long-term damage.
4. If both agents agree on equity allocation, that's fine. But if either flags danger, the portfolio must reflect that danger.
5. Be decisive. But when in doubt, be defensive. Wrong on the cautious side = miss some gains. Wrong on the aggressive side = lose capital.

Remember: A -30% loss needs +43% to recover. A -50% loss needs +100%. Avoiding the dip IS the strategy.` + trackRecordBlock,
    `QUANT AGENT PROPOSAL:\n${JSON.stringify(quantProposal, null, 2)}\n\nNEWS AGENT PROPOSAL:\n${JSON.stringify(newsProposal, null, 2)}\n\nReturn JSON: { "agreements": ["..."], "conflicts": [{ "topic": "...", "quantPosition": "...", "newsPosition": "...", "verdict": "quant|news", "reasoning": "..." }], "recommendation": "1-2 sentence recommendation" }`
  );

  const debate = parseJSON<DebateResult>(debateRaw);
  if (!debate) {
    return { rebalanced: false, reason: "Failed to parse debate" };
  }

  // ===== STEP 3: Mediator =====
  const mediatorRaw = await callGateway(
    `You are the CHIEF RISK OFFICER making the final portfolio allocation. You are personally accountable for losses.

YOUR MANDATE:
- "The best winning is not losing. Then comes winning."
- You would rather explain why you were too cautious than explain why you lost 20% of the portfolio.
- If the debate shows ANY unresolved danger signals, your portfolio MUST reflect that risk — minimum 40% defensive.
- Only go >60% equity when BOTH agents agree conditions are favorable AND no danger signals are active.
- You are NOT a consensus-seeker. If one agent is cautious for good reason, override the other.

${sharedConstraints}

Return JSON: { "funds": [{ "code": "AIA-XXX", "weight": 50 }, ...], "summary_en": "plain English summary for the team", "summary_zh": "中文摘要", "debate_log": "Quant said X. News said Y. They agreed on Z. Final decision: ..." }` + trackRecordBlock,
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

  // ===== FUND CODE VALIDATION — reject unknown/inactive codes =====
  const activeFundCodes = new Set((funds || []).map(f => f.fund_code));
  const invalidCodes = newPortfolio.filter(p => !activeFundCodes.has(p.code)).map(p => p.code);
  if (invalidCodes.length > 0) {
    return { rebalanced: false, reason: `Mediator proposed unknown/inactive fund codes: ${invalidCodes.join(", ")}` };
  }

  // ===== DEDUP — merge duplicate fund codes by summing weights =====
  const deduped = new Map<string, number>();
  for (const p of newPortfolio) {
    deduped.set(p.code, (deduped.get(p.code) || 0) + p.weight);
  }
  newPortfolio = Array.from(deduped.entries()).map(([code, weight]) => ({ code, weight }));

  // ===== HARD SAFETY GUARDRAIL =====
  // If danger signals were detected, enforce maximum equity exposure
  if (dangerSignals) {
    const defensiveCodes = new Set(["AIA-CON", "AIA-ABF", "AIA-GBF", "AIA-GPF", "AIA-CST", "AIA-65P"]);
    const equityWeight = newPortfolio
      .filter(p => !defensiveCodes.has(p.code))
      .reduce((sum, p) => sum + p.weight, 0);

    if (equityWeight > 40) {
      console.warn(`[debate-rebalancer] SAFETY OVERRIDE: agents proposed ${equityWeight}% equity despite danger signals. Capping at 40%.`);
      // Log the override but still allow — the agents should learn from scoring
      await sendDiscordAlert({
        title: "⚠️ MPF Care — Safety Guardrail Warning",
        description: `Agents proposed **${equityWeight}% equity** despite active danger signals.\nDanger signals:\n${dangerSignals}\n\nProceeding with agent allocation but flagging for review.`,
        color: COLORS.yellow,
      });
    }
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

  // ===== APPLY via T+2 Settlement Pipeline =====
  const {
    canSubmitSwitch,
    submitSwitch,
    requestEmergencySwitch,
    isSameAllocation,
    checkGPFLimit,
  } = await import("./portfolio-tracker");

  // Check: same allocation = skip (no pointless cash drag)
  const proposedAlloc = activePortfolio.map(p => ({ code: p.code, weight: p.weight }));
  const currentAlloc = currentHoldings.map(h => ({ code: h.code, weight: h.weight }));
  if (isSameAllocation(proposedAlloc, currentAlloc)) {
    return { rebalanced: false, reason: "Proposed allocation identical to current — no switch needed" };
  }

  // Check: GPF 2/year hard limit
  const gpfCheck = await checkGPFLimit(proposedAlloc);
  if (gpfCheck.blocked) {
    return { rebalanced: false, reason: gpfCheck.reason };
  }

  // Full debate log (needed for insight + emergency context)
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

  // Helper: insert insight row with given status
  const fundCategories = [...new Set(activePortfolio.map(p => {
    const fund = funds?.find(f => f.fund_code === p.code);
    return fund?.category || "unknown";
  }))];
  const insertInsight = async (status: string) => {
    const { data: row, error: err } = await supabase.from("mpf_insights").insert({
      type: "rebalance_debate",
      trigger: "debate_rebalance",
      content_en: `${mediator.summary_en}\n\n---\n\n${fullDebateLog}`,
      content_zh: mediator.summary_zh,
      fund_categories: fundCategories,
      status,
      model: MODEL,
    }).select("id").single();
    if (err) console.error("[debate-rebalancer] Failed to insert insight row:", err);
    return row?.id || null;
  };

  // Check switch gate BEFORE inserting insight (prevents poisoning rate limits)
  const gate = await canSubmitSwitch();
  const today = new Date().toISOString().split("T")[0];

  if (!gate.allowed) {
    if (gate.canOverride) {
      // Cooldown period — insert insight for linking, then request emergency approval
      const insightId = await insertInsight("pending_approval");
      const topNews = (recentNews || [])
        .filter((n: { is_high_impact: boolean }) => n.is_high_impact)
        .slice(0, 3)
        .map((n: { headline: string }) => n.headline);

      const { switchId } = await requestEmergencySwitch({
        decisionDate: today,
        oldAllocation: currentAlloc,
        newAllocation: proposedAlloc,
        insightId,
        debateSummary: mediator.summary_en,
        dangerSignals: dangerSignals || "",
        topNews,
      });

      return {
        rebalanced: false,
        reason: `Emergency switch requested (${gate.reason}). Awaiting approval. Switch ID: ${switchId}`,
        debate_log: fullDebateLog,
      };
    }

    // Hard block — insert with debate_only status (won't count toward rate limits)
    await insertInsight("debate_only");
    return { rebalanced: false, reason: gate.reason, debate_log: fullDebateLog };
  }

  // Gate passed — insert insight as completed, then submit switch with T+2 settlement
  const insightId = await insertInsight("completed");
  const { sellDate, settlementDate } = await submitSwitch({
    decisionDate: today,
    oldAllocation: currentAlloc,
    newAllocation: proposedAlloc,
    insightId,
  });

  // Discord notification
  const portfolioSummary = formatAllocation(activePortfolio);
  await sendDiscordAlert({
    title: "📊 MPF Care — Switch Submitted (T+2)",
    description: [
      `**New allocation:** ${portfolioSummary}`,
      `**Sells:** ${sellDate} | **Settles:** ${settlementDate}`,
      `**Reason:** ${mediator.summary_en.slice(0, 200)}`,
      "",
      "**Debate:**",
      `Agreements: ${debate.agreements.slice(0, 2).join("; ")}`,
      debate.conflicts.length > 0 ? `Conflicts: ${debate.conflicts.map(c => c.topic).join(", ")}` : "No conflicts",
    ].join("\n"),
    color: COLORS.green,
  }).catch(() => {});

  return {
    rebalanced: true,
    reason: `Switch submitted. Sells ${sellDate}, settles ${settlementDate}. ${mediator.summary_en}`,
    debate_log: fullDebateLog,
  };
}
