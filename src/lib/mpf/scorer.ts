// src/lib/mpf/scorer.ts — Independent scorer agent
// Evaluates reasoning quality of rebalance decisions, not just outcomes.
// Called by the scoring cron, NOT by the debate pipeline.

import { createAdminClient } from "@/lib/supabase/admin";

const GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/chat/completions";
const MODEL = "anthropic/claude-sonnet-4.6";

interface ScoreInput {
  debateLog: string;
  allocation: { code: string; weight: number }[];
  actualReturns: Record<string, number>; // fund_code → return % over period
  portfolioReturn: number; // weighted portfolio return %
  baselineReturn: number; // "do nothing" return %
  period: string; // "7d" | "30d" | "90d"
}

interface ScorerOutput {
  claims: { claim: string; outcome: "correct" | "incorrect" | "inconclusive"; evidence: string }[];
  win_rate: number;
  reasoning_quality: "sound" | "lucky" | "wrong" | "inconclusive";
  lessons: string[];
}

/**
 * Run the independent scorer agent on a rebalance decision.
 * Extracts testable claims from the debate log, scores them against actual data.
 */
export async function scoreDecision(input: ScoreInput): Promise<ScorerOutput | null> {
  const key = process.env.AI_GATEWAY_API_KEY;
  if (!key) return null;

  const returnsText = Object.entries(input.actualReturns)
    .sort((a, b) => b[1] - a[1])
    .map(([code, ret]) => `${code}: ${ret > 0 ? "+" : ""}${ret.toFixed(2)}%`)
    .join("\n");

  const allocationText = input.allocation
    .map(a => `${a.code}: ${a.weight}%`)
    .join(", ");

  const delta = input.portfolioReturn - input.baselineReturn;
  const deltaText = `${delta > 0 ? "+" : ""}${delta.toFixed(2)}%`;

  const systemPrompt = `You are an independent auditor scoring a pension fund's AI rebalancing decision. You must be OBJECTIVE — not generous, not harsh. You are evaluating the REASONING, not just the outcome.

A portfolio can go up because the whole market went up — that's LUCKY, not SOUND.
A portfolio can go down because of an unpredictable event — that might still be SOUND reasoning.

Score each identifiable claim in the debate log against actual data.

Return ONLY valid JSON:
{
  "claims": [
    { "claim": "what the debate implied would happen", "outcome": "correct|incorrect|inconclusive", "evidence": "actual data that supports/refutes the claim" }
  ],
  "win_rate": 0.67,
  "reasoning_quality": "sound|lucky|wrong|inconclusive",
  "lessons": ["what the model should learn from this outcome"]
}`;

  const userContent = `PERIOD: ${input.period} after the rebalance decision

DEBATE LOG (the reasoning behind the decision):
${input.debateLog}

ALLOCATION CHOSEN: ${allocationText}

ACTUAL FUND RETURNS (${input.period} after decision):
${returnsText}

PORTFOLIO RETURN: ${input.portfolioReturn > 0 ? "+" : ""}${input.portfolioReturn.toFixed(2)}%
BASELINE (hold previous): ${input.baselineReturn > 0 ? "+" : ""}${input.baselineReturn.toFixed(2)}%
DELTA vs BASELINE: ${deltaText}

Analyze the debate reasoning against what actually happened. Extract every testable claim, score it, then assess overall reasoning quality.`;

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
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) return null;

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || "";
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;

    return JSON.parse(match[0]) as ScorerOutput;
  } catch {
    return null;
  }
}

/**
 * Compute portfolio return over a period given allocation and fund prices.
 * Returns weighted return percentage.
 */
export function computePortfolioReturn(
  allocation: { code: string; weight: number }[],
  fundReturns: Record<string, number>
): number {
  let totalReturn = 0;
  for (const a of allocation) {
    const fundReturn = fundReturns[a.code] || 0;
    totalReturn += fundReturn * (a.weight / 100);
  }
  return totalReturn;
}

/**
 * Get fund returns over a period from price data.
 * Returns map of fund_code → return percentage.
 */
export async function getFundReturnsForPeriod(
  startDate: string,
  endDate: string
): Promise<Record<string, number>> {
  const supabase = createAdminClient();

  const { data: funds, error: fundsError } = await supabase
    .from("mpf_funds")
    .select("id, fund_code")
    .eq("is_active", true);
  if (fundsError) console.error("[scorer] Failed to fetch active funds:", fundsError);

  const returns: Record<string, number> = {};

  for (const fund of funds || []) {
    const { data: startPrice, error: startPriceError } = await supabase
      .from("mpf_prices")
      .select("nav")
      .eq("fund_id", fund.id)
      .lte("date", startDate)
      .order("date", { ascending: false })
      .limit(1)
      .single();
    if (startPriceError && startPriceError.code !== "PGRST116") console.error("[scorer] Failed to fetch start price for fund:", fund.fund_code, startPriceError);

    const { data: endPrice, error: endPriceError } = await supabase
      .from("mpf_prices")
      .select("nav")
      .eq("fund_id", fund.id)
      .lte("date", endDate)
      .order("date", { ascending: false })
      .limit(1)
      .single();
    if (endPriceError && endPriceError.code !== "PGRST116") console.error("[scorer] Failed to fetch end price for fund:", fund.fund_code, endPriceError);

    if (startPrice && endPrice && startPrice.nav > 0) {
      returns[fund.fund_code] = ((endPrice.nav - startPrice.nav) / startPrice.nav) * 100;
    }
  }

  return returns;
}
