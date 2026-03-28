// src/lib/ilas/rebalancer.ts — ILAS Dual-Agent Debate Rebalancer
// 4-call pipeline: Quant (parallel) + News (parallel) → Debate → Mediator
// Parameterized by portfolioType: 'accumulation' | 'distribution'

import { createAdminClient } from "@/lib/supabase/admin";
import {
  ILAS_DEFENSIVE_FUNDS,
  ILAS_INVESTMENT_PROFILE,
  ILAS_REBALANCER_CONFIG,
  formatIlasAllocation,
} from "./constants";
import {
  submitIlasSwitch,
  canSubmitIlasSwitch,
  requestEmergencyIlasSwitch,
  isSameAllocation,
} from "./portfolio-tracker";
import type { IlasPortfolioType } from "./portfolio-tracker";
import type { FundAllocation } from "./types";
import { callGateway, parseJSON, detectDangerSignals } from "@/lib/mpf/rebalancer";
import { sendDiscordAlert, COLORS } from "@/lib/discord";

const MODEL = "anthropic/claude-sonnet-4.6";

// ===== Types =====

export interface IlasPortfolioProposal {
  funds: { code: string; weight: number; reasoning: string }[];
  summary: string;
}

interface IlasDebateResult {
  agreements: string[];
  conflicts: {
    topic: string;
    quantPosition: string;
    newsPosition: string;
    verdict: string;
    reasoning: string;
  }[];
  recommendation: string;
}

interface IlasMediatorResult {
  funds: { code: string; weight: number }[];
  summary_en: string;
  summary_zh: string;
  debate_log: string;
}

export interface IlasRebalanceResult {
  rebalanced: boolean;
  reason: string;
  insightId?: string;
  orderId?: string;
  debate_log?: string;
}

// ===== Shared Constraints (ILAS-specific) =====

function buildIlasSharedConstraints(
  availableFunds: string,
  defensiveFunds: string[],
  portfolioType: IlasPortfolioType,
  dangerSignals: string = ""
): string {
  const defensiveList = defensiveFunds.join(", ");
  return `
INVESTMENT PHILOSOPHY — "The best winning is not losing. Then comes winning."
Your DEFAULT stance is DEFENSIVE. You must EARN the right to allocate to equity with clear evidence.

CONTEXT: You are managing the ${portfolioType} portfolio of an ILAS investment-linked insurance product.
${portfolioType === "distribution" ? "This is a DISTRIBUTION portfolio — income generation and capital preservation are paramount. Prefer funds with regular dividend payouts." : "This is an ACCUMULATION portfolio — long-term capital growth is the goal, but downside protection remains the priority."}

STRICT RULES:
1. Output exactly ${ILAS_REBALANCER_CONFIG.NUM_FUNDS_IN_PORTFOLIO} funds. Duplicates allowed (e.g., all 3 can be the same fund for 100% concentration).
2. Weights: 0-100% in ${ILAS_REBALANCER_CONFIG.WEIGHT_INCREMENT}% increments. Total MUST = 100%.
3. DEFENSIVE-FIRST: Start from 100% bonds/money-market. Add equity ONLY with specific evidence it's safe.
4. Capital preservation is NON-NEGOTIABLE. A 30% loss requires a 43% gain to recover. Avoiding the dip IS the alpha.
5. If danger signals are present, maximum ${ILAS_REBALANCER_CONFIG.EQUITY_CEILING_ON_DANGER}% equity unless you provide exceptional justification.
6. 100% defensive (bonds + money market) is a VALID and often CORRECT decision. Don't feel pressure to hold equity.
7. "The market might recover" is NOT a reason to stay in equity. Only stay if the data says the risk is already priced in.
${dangerSignals}

Available funds: ${availableFunds}
Defensive funds: ${defensiveList}

Return ONLY valid JSON (no markdown):
{ "funds": [{ "code": "XXX", "weight": 50, "reasoning": "why" }, ...], "summary": "1-2 sentence summary" }`;
}

// ===== Quant Agent =====

async function runIlasQuantAgent(
  metricsText: string,
  currentPortfolioText: string,
  profileText: string,
  sharedConstraints: string,
  portfolioType: IlasPortfolioType
): Promise<IlasPortfolioProposal | null> {
  const raw = await callGateway(
    `You are a RISK-FIRST quantitative analyst for an ILAS investment-linked insurance ${portfolioType} portfolio. Your job is to PROTECT capital first, grow it second.

DECISION FRAMEWORK (in order):
1. CHECK SORTINO RATIOS: If most equity funds have Sortino < 0.5, the risk-reward is unfavorable. Go defensive.
2. CHECK MAX DRAWDOWN: If any fund in the current portfolio has drawdown > -15%, that fund must be replaced or reduced.
3. CHECK MOMENTUM: If 3-month momentum is negative for majority of equity funds, the trend is DOWN. Do not fight the trend.
4. ONLY THEN consider upside: If Sortino > 1.0, drawdown is recovering, and momentum is positive — allocate to equity.

You are a SKEPTIC, not an optimist. Your job is to say "the numbers don't justify equity" when they don't. Propose a ${ILAS_REBALANCER_CONFIG.NUM_FUNDS_IN_PORTFOLIO}-fund portfolio based PURELY on these metrics.`,
    `${profileText}\n\nCURRENT PORTFOLIO:\n${currentPortfolioText}\n\nFUND METRICS (3Y):\n${metricsText}\n\n${sharedConstraints}`
  );
  return parseJSON<IlasPortfolioProposal>(raw);
}

// ===== Main Pipeline =====

/**
 * Check if ILAS portfolio needs rebalancing and execute via dual-agent debate.
 * Called after news classification to react to market events.
 *
 * Rules:
 * - Max 1 rebalance/week for normal drift
 * - Max 3 rebalances/day (absolute ceiling)
 * - NO weekly limit for high-impact news (still capped at 3/day)
 */
export async function evaluateAndRebalanceIlas(
  portfolioType: IlasPortfolioType,
  highImpactCount: number
): Promise<IlasRebalanceResult> {
  const supabase = createAdminClient();
  const triggerTag = `debate_rebalance_${portfolioType}`;
  const logPrefix = `[ilas-rebalancer:${portfolioType}]`;

  // Daily cap: max 3 rebalances per day
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayISO = todayStart.toISOString();
  const { data: todayRebalances, error: todayError } = await supabase
    .from("ilas_insights")
    .select("id")
    .or("type.eq.alert,type.eq.rebalance_debate")
    .or(`trigger.eq.portfolio_rebalance,trigger.eq.${triggerTag}`)
    .gte("created_at", todayISO);
  if (todayError) console.error(`${logPrefix} Failed to fetch today's rebalances:`, todayError);

  const todayCount = todayRebalances?.length || 0;
  console.log(`${logPrefix} Daily cap check: ${todayCount} rebalances today`);
  if (todayCount >= ILAS_REBALANCER_CONFIG.DAILY_CAP) {
    return { rebalanced: false, reason: `Daily rebalance cap reached (${ILAS_REBALANCER_CONFIG.DAILY_CAP}/day)` };
  }

  // Weekly rate limit (skip if high-impact news)
  if (highImpactCount === 0) {
    const { data: lastRebalance, error: lastRebalanceError } = await supabase
      .from("ilas_insights")
      .select("created_at")
      .or("type.eq.alert,type.eq.rebalance_debate")
      .or(`trigger.eq.portfolio_rebalance,trigger.eq.${triggerTag}`)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    if (lastRebalanceError && lastRebalanceError.code !== "PGRST116")
      console.error(`${logPrefix} Failed to fetch last rebalance:`, lastRebalanceError);

    if (lastRebalance) {
      const daysSince = (Date.now() - new Date(lastRebalance.created_at).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < ILAS_REBALANCER_CONFIG.WEEKLY_LIMIT_DAYS) {
        return { rebalanced: false, reason: `Last rebalance ${daysSince.toFixed(1)} days ago, no high-impact news` };
      }
    }
  }

  // ===== DATA INTEGRITY GATE — refuse to rebalance with incomplete data =====
  const { data: activeFunds, error: activeFundsError } = await supabase
    .from("ilas_funds")
    .select("id, fund_code")
    .eq("is_active", true)
    .eq("is_distribution", portfolioType === "distribution");
  if (activeFundsError) console.error(`${logPrefix} Failed to fetch active funds:`, activeFundsError);

  const totalActive = activeFunds?.length || 0;

  // Check 1: Price freshness — all funds must have prices within 5 business days
  if (totalActive > 0) {
    const fiveBusinessDaysAgo = new Date();
    fiveBusinessDaysAgo.setDate(fiveBusinessDaysAgo.getDate() - ILAS_REBALANCER_CONFIG.PRICE_FRESHNESS_DAYS);
    const cutoff = fiveBusinessDaysAgo.toISOString().split("T")[0];

    const staleFunds: string[] = [];
    for (const f of activeFunds || []) {
      const { data: latestPrice, error: latestPriceError } = await supabase
        .from("ilas_prices")
        .select("date")
        .eq("fund_id", f.id)
        .order("date", { ascending: false })
        .limit(1)
        .single();
      if (latestPriceError && latestPriceError.code !== "PGRST116")
        console.error(`${logPrefix} Failed to fetch latest price for fund:`, f.fund_code, latestPriceError);

      if (!latestPrice || latestPrice.date < cutoff) {
        staleFunds.push(f.fund_code);
      }
    }

    if (staleFunds.length > 0) {
      const msg = `BLOCKED: stale price data for ${staleFunds.join(", ")}. Fix data pipeline before rebalancing.`;
      console.error(`${logPrefix} ${msg}`);
      await sendDiscordAlert({
        title: `🚫 ILAS Track — ${portfolioType} Rebalance Blocked (Stale Data)`,
        description: `**${staleFunds.length} funds** have prices older than 5 business days:\n${staleFunds.join(", ")}\n\nRun the price cron or data backfill to fix.`,
        color: COLORS.red,
      });
      return { rebalanced: false, reason: msg };
    }
  }

  // Check 2: Metrics coverage — 80% of active funds must have 3Y metrics
  const activeFundCodes = (activeFunds || []).map(f => f.fund_code);
  const { data: metricsCount, error: metricsCountError } = await supabase
    .from("ilas_fund_metrics")
    .select("fund_code")
    .eq("period", "3y")
    .in("fund_code", activeFundCodes.length > 0 ? activeFundCodes : ["__none__"]);
  if (metricsCountError) console.error(`${logPrefix} Failed to fetch metrics count:`, metricsCountError);

  const fundsWithMetrics = metricsCount?.length || 0;
  const coveragePct = totalActive > 0 ? (fundsWithMetrics / totalActive) * 100 : 0;

  if (coveragePct < ILAS_REBALANCER_CONFIG.METRICS_COVERAGE_PCT * 100) {
    const msg = `BLOCKED: insufficient metrics coverage (${fundsWithMetrics}/${totalActive} funds = ${coveragePct.toFixed(0)}%). Run metrics cron first.`;
    console.error(`${logPrefix} ${msg}`);
    await sendDiscordAlert({
      title: `🚫 ILAS Track — ${portfolioType} Rebalance Blocked (Missing Metrics)`,
      description: `Only **${fundsWithMetrics}/${totalActive}** funds have 3Y metrics (need 80%+).\n\nRun the metrics cron to fix.`,
      color: COLORS.red,
    });
    return { rebalanced: false, reason: msg };
  }

  console.log(`${logPrefix} Data integrity OK: all prices fresh, metrics ${fundsWithMetrics}/${totalActive} (${coveragePct.toFixed(0)}%)`);

  // ===== Gather data for agents =====
  const { data: portfolio, error: portfolioError } = await supabase
    .from("ilas_reference_portfolio")
    .select("fund_id, weight, note")
    .eq("portfolio_type", portfolioType);
  if (portfolioError) console.error(`${logPrefix} Failed to fetch reference portfolio:`, portfolioError);

  if (!portfolio?.length) return { rebalanced: false, reason: `No ${portfolioType} reference portfolio set` };

  const { data: funds, error: fundsError } = await supabase
    .from("ilas_funds")
    .select("id, fund_code, name_en, category, risk_rating")
    .eq("is_active", true)
    .eq("is_distribution", portfolioType === "distribution");
  if (fundsError) console.error(`${logPrefix} Failed to fetch funds:`, fundsError);

  const fundMap = new Map((funds || []).map(f => [f.id, f]));
  const fundCodeToId = new Map((funds || []).map(f => [f.fund_code, f.id]));

  const currentHoldings = portfolio.map(p => {
    const fund = fundMap.get(p.fund_id);
    return { code: fund?.fund_code || "", name: fund?.name_en || "", weight: p.weight };
  });

  // Get fund metrics (filtered to this portfolio's fund codes)
  const { data: metrics, error: metricsError } = await supabase
    .from("ilas_fund_metrics")
    .select("*")
    .eq("period", "3y")
    .in("fund_code", activeFundCodes.length > 0 ? activeFundCodes : ["__none__"]);
  if (metricsError) console.error(`${logPrefix} Failed to fetch fund metrics:`, metricsError);

  const metricsText = (metrics || []).map(m =>
    `${m.fund_code}: Sortino=${m.sortino_ratio?.toFixed(2) ?? "N/A"}, Sharpe=${m.sharpe_ratio?.toFixed(2) ?? "N/A"}, MaxDD=${m.max_drawdown_pct !== null ? (m.max_drawdown_pct * 100).toFixed(1) + "%" : "N/A"}, CAGR=${m.annualized_return_pct !== null ? (m.annualized_return_pct * 100).toFixed(1) + "%" : "N/A"}, FER=${m.expense_ratio_pct?.toFixed(2) ?? "N/A"}%, Mom3M=${m.momentum_score !== null ? (m.momentum_score * 100).toFixed(1) + "%" : "N/A"}`
  ).join("\n");

  // Get recent news (shared table — mpf_news)
  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const { data: recentNews, error: recentNewsError } = await supabase
    .from("mpf_news")
    .select("headline, impact_tags, sentiment, region, is_high_impact")
    .gte("published_at", twoDaysAgo)
    .order("published_at", { ascending: false })
    .limit(20);
  if (recentNewsError) console.error(`${logPrefix} Failed to fetch recent news:`, recentNewsError);

  const newsText = (recentNews || []).map(n =>
    `[${n.sentiment}/${n.region}${n.is_high_impact ? "/HIGH-IMPACT" : ""}] ${n.headline} (tags: ${n.impact_tags?.join(", ") || "none"})`
  ).join("\n");

  const currentPortfolioText = currentHoldings.map(h => `${h.code} (${h.name}): ${h.weight}%`).join("\n");
  const availableFunds = (funds || []).map(f => `${f.fund_code} (${f.name_en})`).join(", ");

  // ===== DANGER DETECTION =====
  const dangerSignals = detectDangerSignals(metricsText);
  if (dangerSignals) {
    console.log(`${logPrefix} ${dangerSignals}`);
  }

  // ===== PROFILE TEXT =====
  const profileText = [
    `ILAS ${portfolioType.toUpperCase()} PORTFOLIO: ${ILAS_INVESTMENT_PROFILE.label} — ${ILAS_INVESTMENT_PROFILE.description}`,
    `PERSPECTIVE: Risk-first, defensive by default. Equity allocation must be EARNED with data.`,
    `YOUR JOB: Protect capital. When in doubt, the MORE CAUTIOUS approach wins.`,
  ].join("\n");

  const defensiveFunds = ILAS_DEFENSIVE_FUNDS[portfolioType] || [];
  const sharedConstraints = buildIlasSharedConstraints(availableFunds, defensiveFunds, portfolioType, dangerSignals);

  // ===== FEEDBACK INJECTION — last 5 scored decisions =====
  let trackRecordBlock = "";
  const { data: recentScores, error: scoresError } = await supabase
    .from("ilas_rebalance_scores")
    .select("reasoning_quality, win_rate, lessons, actual_return_pct, baseline_return_pct, scored_at")
    .not("insight_id", "is", null)
    .order("scored_at", { ascending: false })
    .limit(5);
  if (scoresError) console.error(`${logPrefix} Failed to fetch recent scores:`, scoresError);

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
    runIlasQuantAgent(metricsText, currentPortfolioText, profileText, sharedConstraints, portfolioType),
    callGateway(
      `You are a GEOPOLITICAL RISK analyst for an ILAS investment-linked insurance ${portfolioType} portfolio. Your PRIMARY job is to detect DANGER before it hits the portfolio.

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

  const newsProposal = parseJSON<IlasPortfolioProposal>(newsRaw);

  if (!quantProposal || !newsProposal) {
    return { rebalanced: false, reason: "Failed to parse agent proposals" };
  }

  // ===== STEP 2: Debate =====
  const debateRaw = await callGateway(
    `You are the RISK COMMITTEE reviewing two proposals for an ILAS ${portfolioType} insurance portfolio. Your bias is TOWARD SAFETY.

DEBATE RULES:
1. When Quant and News DISAGREE on risk level, the MORE CAUTIOUS position wins by default. The burden of proof is on the BULLISH side.
2. If EITHER agent recommends >50% defensive, take that seriously. One agent seeing danger is enough to act.
3. "Long-term recovery" is not a valid argument during active risk events. Short-term losses compound into long-term damage.
4. If both agents agree on equity allocation, that's fine. But if either flags danger, the portfolio must reflect that danger.
5. Be decisive. But when in doubt, be defensive. Wrong on the cautious side = miss some gains. Wrong on the aggressive side = lose capital.

Remember: A -30% loss needs +43% to recover. A -50% loss needs +100%. Avoiding the dip IS the strategy.` + trackRecordBlock,
    `QUANT AGENT PROPOSAL:\n${JSON.stringify(quantProposal, null, 2)}\n\nNEWS AGENT PROPOSAL:\n${JSON.stringify(newsProposal, null, 2)}\n\nReturn JSON: { "agreements": ["..."], "conflicts": [{ "topic": "...", "quantPosition": "...", "newsPosition": "...", "verdict": "quant|news", "reasoning": "..." }], "recommendation": "1-2 sentence recommendation" }`
  );

  const debate = parseJSON<IlasDebateResult>(debateRaw);
  if (!debate) {
    return { rebalanced: false, reason: "Failed to parse debate" };
  }

  // ===== STEP 3: Mediator =====
  const mediatorRaw = await callGateway(
    `You are the CHIEF RISK OFFICER making the final portfolio allocation for an ILAS ${portfolioType} insurance product. You are personally accountable for losses.

YOUR MANDATE:
- "The best winning is not losing. Then comes winning."
- You would rather explain why you were too cautious than explain why you lost 20% of the portfolio.
- If the debate shows ANY unresolved danger signals, your portfolio MUST reflect that risk — minimum 40% defensive.
- Only go >60% equity when BOTH agents agree conditions are favorable AND no danger signals are active.
- You are NOT a consensus-seeker. If one agent is cautious for good reason, override the other.

${sharedConstraints}

Return JSON: { "funds": [{ "code": "XXX", "weight": 50 }, ...], "summary_en": "plain English summary for the team", "summary_zh": "中文摘要", "debate_log": "Quant said X. News said Y. They agreed on Z. Final decision: ..." }` + trackRecordBlock,
    `QUANT PROPOSAL:\n${JSON.stringify(quantProposal, null, 2)}\n\nNEWS PROPOSAL:\n${JSON.stringify(newsProposal, null, 2)}\n\nDEBATE:\n${JSON.stringify(debate, null, 2)}\n\nFUND METRICS:\n${metricsText}\n\nNEWS SUMMARY:\n${newsText || "No recent news"}`
  );

  const mediator = parseJSON<IlasMediatorResult>(mediatorRaw);
  if (!mediator) {
    return { rebalanced: false, reason: "Failed to parse mediator verdict" };
  }

  // ===== VALIDATION =====
  let newPortfolio = mediator.funds;
  if (!Array.isArray(newPortfolio) || newPortfolio.length < 1) {
    return { rebalanced: false, reason: "Mediator proposed empty portfolio" };
  }

  // ===== HARD SAFETY GUARDRAIL =====
  if (dangerSignals) {
    const defensiveSet = new Set(defensiveFunds);
    const equityWeight = newPortfolio
      .filter(p => !defensiveSet.has(p.code))
      .reduce((sum, p) => sum + p.weight, 0);

    if (equityWeight > ILAS_REBALANCER_CONFIG.EQUITY_CEILING_ON_DANGER) {
      console.warn(`${logPrefix} SAFETY OVERRIDE: agents proposed ${equityWeight}% equity despite danger signals. Capping at ${ILAS_REBALANCER_CONFIG.EQUITY_CEILING_ON_DANGER}%.`);
      await sendDiscordAlert({
        title: `⚠️ ILAS Track — ${portfolioType} Safety Guardrail Warning`,
        description: `Agents proposed **${equityWeight}% equity** despite active danger signals.\nDanger signals:\n${dangerSignals}\n\nProceeding with agent allocation but flagging for review.`,
        color: COLORS.yellow,
      });
    }
  }

  // Truncate to NUM_FUNDS_IN_PORTFOLIO if needed
  const maxFunds = ILAS_REBALANCER_CONFIG.NUM_FUNDS_IN_PORTFOLIO;
  if (newPortfolio.length > maxFunds) {
    newPortfolio = newPortfolio.sort((a, b) => b.weight - a.weight).slice(0, maxFunds);
    const rawTotal = newPortfolio.reduce((s, p) => s + p.weight, 0);
    newPortfolio = newPortfolio.map(p => ({
      ...p,
      weight: Math.round((p.weight / rawTotal) * (100 / ILAS_REBALANCER_CONFIG.WEIGHT_INCREMENT)) * ILAS_REBALANCER_CONFIG.WEIGHT_INCREMENT,
    }));
    const scaledTotal = newPortfolio.reduce((s, p) => s + p.weight, 0);
    if (scaledTotal !== 100) newPortfolio[0].weight += 100 - scaledTotal;
  }

  // Pad to NUM_FUNDS_IN_PORTFOLIO if fewer
  if (newPortfolio.length < maxFunds) {
    const usedCodes = new Set(newPortfolio.map(p => p.code));
    const fillers = defensiveFunds.filter(c => !usedCodes.has(c));
    while (newPortfolio.length < maxFunds && fillers.length > 0) {
      newPortfolio.push({ code: fillers.shift()!, weight: 0 });
    }
  }

  const totalWeight = newPortfolio.reduce((s, p) => s + p.weight, 0);
  if (totalWeight !== 100) {
    return { rebalanced: false, reason: `Portfolio total ${totalWeight}% (must be 100%)` };
  }

  for (const p of newPortfolio) {
    if (p.weight < 0 || p.weight > 100 || p.weight % ILAS_REBALANCER_CONFIG.WEIGHT_INCREMENT !== 0) {
      return { rebalanced: false, reason: `Invalid weight ${p.weight}% for ${p.code}` };
    }
  }

  const activePortfolio = newPortfolio.filter(p => p.weight > 0);
  if (activePortfolio.length === 0) {
    return { rebalanced: false, reason: "All funds at 0%" };
  }

  // ===== APPLY via T+2 Settlement Pipeline =====

  // Check: same allocation = skip
  const proposedAlloc: FundAllocation[] = activePortfolio.map(p => ({ code: p.code, weight: p.weight }));
  const currentAlloc: FundAllocation[] = currentHoldings.map(h => ({ code: h.code, weight: h.weight }));
  if (isSameAllocation(proposedAlloc, currentAlloc)) {
    return { rebalanced: false, reason: "Proposed allocation identical to current — no switch needed" };
  }

  // No GPF limit check for ILAS (not applicable)

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

  // Insert insight FIRST to get the ID for linking
  const { data: insightRow, error: insightInsertError } = await supabase.from("ilas_insights").insert({
    type: "rebalance_debate",
    trigger: triggerTag,
    content_en: `${mediator.summary_en}\n\n---\n\n${fullDebateLog}`,
    content_zh: mediator.summary_zh,
    fund_categories: [...new Set(activePortfolio.map(p => {
      const fund = funds?.find(f => f.fund_code === p.code);
      return fund?.category || "unknown";
    }))],
    status: "completed",
    model: MODEL,
  }).select("id").single();
  if (insightInsertError) console.error(`${logPrefix} Failed to insert insight row:`, insightInsertError);

  const insightId = insightRow?.id || null;

  // Check switch gate
  const gate = await canSubmitIlasSwitch(portfolioType);
  const today = new Date().toISOString().split("T")[0];

  if (!gate.allowed) {
    if (gate.canOverride) {
      // Cooldown period — request emergency approval
      const topNews = (recentNews || [])
        .filter((n: { is_high_impact: boolean }) => n.is_high_impact)
        .slice(0, 3)
        .map((n: { headline: string }) => n.headline);

      const { orderId } = await requestEmergencyIlasSwitch({
        portfolioType,
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
        reason: `Emergency switch requested (${gate.reason}). Awaiting approval. Order ID: ${orderId}`,
        insightId: insightId || undefined,
        orderId,
        debate_log: fullDebateLog,
      };
    }

    // Hard block (pending switch in progress)
    return {
      rebalanced: false,
      reason: gate.reason,
      insightId: insightId || undefined,
      debate_log: fullDebateLog,
    };
  }

  // Gate passed — submit switch with T+2 settlement
  const { orderId, sellDate, settlementDate } = await submitIlasSwitch({
    portfolioType,
    decisionDate: today,
    oldAllocation: currentAlloc,
    newAllocation: proposedAlloc,
    insightId,
  });

  // Discord notification
  const portfolioSummary = formatIlasAllocation(activePortfolio);
  await sendDiscordAlert({
    title: `📊 ILAS Track — ${portfolioType === "accumulation" ? "Accumulation" : "Distribution"} Rebalance Submitted`,
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
    insightId: insightId || undefined,
    orderId,
    debate_log: fullDebateLog,
  };
}
