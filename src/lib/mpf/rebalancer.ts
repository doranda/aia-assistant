// src/lib/mpf/rebalancer.ts
import { createAdminClient } from "@/lib/supabase/admin";
import { IMPACT_TAG_TO_FUNDS } from "./constants";

interface PortfolioHolding {
  fund_id: string;
  fund_code: string;
  weight: number;
  name_en: string;
  category: string;
  daily_change_pct: number | null;
}

interface RebalanceResult {
  rebalanced: boolean;
  reason: string;
  changes?: { from?: string; to?: string; weight: number; rationale: string }[];
}

/**
 * Check if portfolio needs rebalancing and execute if so.
 * Called after news classification to react to market events.
 *
 * Rules:
 * - Max 1 rebalance/week for normal drift
 * - NO limit for high-impact news
 * - Only change if evidence supports it
 */
export async function evaluateAndRebalance(highImpactCount: number): Promise<RebalanceResult> {
  const supabase = createAdminClient();

  // 1. Check last rebalance time (skip if within 7 days, unless high-impact)
  if (highImpactCount === 0) {
    const { data: lastRebalance } = await supabase
      .from("mpf_insights")
      .select("created_at")
      .eq("type", "alert")
      .eq("trigger", "portfolio_rebalance")
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

  // 2. Get current portfolio
  const { data: portfolio } = await supabase
    .from("mpf_reference_portfolio")
    .select("fund_id, weight, note");

  if (!portfolio?.length) return { rebalanced: false, reason: "No reference portfolio set" };

  // 3. Get fund details + latest prices
  const { data: funds } = await supabase
    .from("mpf_funds")
    .select("id, fund_code, name_en, category, risk_rating");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fundMap = new Map((funds || []).map((f: any) => [f.id, f]));

  const { data: latestPrices } = await supabase
    .from("mpf_prices")
    .select("fund_id, daily_change_pct, date")
    .order("date", { ascending: false })
    .limit(200);

  const priceMap = new Map<string, number>();
  for (const p of latestPrices || []) {
    if (!priceMap.has(p.fund_id)) priceMap.set(p.fund_id, p.daily_change_pct || 0);
  }

  const holdings: PortfolioHolding[] = portfolio.map(p => {
    const fund = fundMap.get(p.fund_id);
    return {
      fund_id: p.fund_id,
      fund_code: fund?.fund_code || "",
      weight: p.weight,
      name_en: fund?.name_en || "",
      category: fund?.category || "",
      daily_change_pct: priceMap.get(p.fund_id) ?? null,
    };
  });

  // 4. Get recent high-impact news (last 24 hours)
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recentHighImpact } = await supabase
    .from("mpf_news")
    .select("headline, impact_tags, sentiment, region")
    .eq("is_high_impact", true)
    .gte("published_at", oneDayAgo);

  // 5. Get ALL fund performance for comparison
  const allFundPerf = new Map<string, number>();
  for (const f of funds || []) {
    const change = priceMap.get(f.id);
    if (change !== undefined) allFundPerf.set(f.fund_code, change);
  }

  // 6. AI-driven rebalance decision via OpenRouter
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (!openRouterKey) return { rebalanced: false, reason: "No OpenRouter API key" };

  const prompt = `You are an MPF fund portfolio manager for AIA Hong Kong. Analyze the current portfolio and market conditions, then decide if rebalancing is needed.

CURRENT PORTFOLIO:
${holdings.map(h => `- ${h.fund_code} (${h.name_en}): ${h.weight}% weight, latest change: ${h.daily_change_pct?.toFixed(2) || "N/A"}%`).join("\n")}

HIGH-IMPACT NEWS (last 24h):
${(recentHighImpact || []).length === 0 ? "None" : (recentHighImpact || []).map(n => `- [${n.sentiment}/${n.region}] ${n.headline} (tags: ${n.impact_tags?.join(", ")})`).join("\n")}

ALL FUND PERFORMANCE (latest monthly change):
${Array.from(allFundPerf.entries()).sort((a, b) => b[1] - a[1]).map(([code, change]) => `- ${code}: ${change > 0 ? "+" : ""}${change.toFixed(2)}%`).join("\n")}

AVAILABLE FUNDS FOR SWAPS:
AIA-AEF (Asia Equity), AIA-EEF (Europe Equity), AIA-GCF (Greater China Equity), AIA-HEF (HK Equity), AIA-JEF (Japan Equity), AIA-NAF (North America Equity), AIA-GRF (Green/ESG), AIA-AMI (US Index), AIA-EAI (Eurasia Index), AIA-HCI (HK/China Index), AIA-WIF (World Index), AIA-GRW (Growth Mixed), AIA-BAL (Balanced), AIA-CST (Capital Stable), AIA-CHD (China/HK Dynamic), AIA-MCF (Manager's Choice), AIA-ABF (Asia Bond), AIA-GBF (Global Bond), AIA-CON (Conservative)

RULES:
- Portfolio must have 1-5 funds
- Weights in 10% increments (10%, 20%, ... 100%)
- Weights must total exactly 100%
- Only rebalance if there's a clear reason (don't change for the sake of changing)
- Consider: regional risk, performance trends, news impact, diversification

Return ONLY valid JSON:
{
  "should_rebalance": true/false,
  "reason": "brief explanation",
  "new_portfolio": [
    { "fund_code": "AIA-XXX", "weight": 30, "rationale": "why this fund at this weight" }
  ]
}

If should_rebalance is false, new_portfolio can be empty.`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openRouterKey}`,
      "HTTP-Referer": "https://aia-assistant.vercel.app",
    },
    body: JSON.stringify({
      model: "nvidia/nemotron-3-super-120b-a12b:free",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
    }),
    signal: controller.signal,
  });

  clearTimeout(timeout);

  if (!res.ok) return { rebalanced: false, reason: `OpenRouter error: ${res.status}` };

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || "";
  const jsonMatch = content.match(/\{[\s\S]*\}/);

  if (!jsonMatch) return { rebalanced: false, reason: "AI returned invalid response" };

  let decision;
  try {
    decision = JSON.parse(jsonMatch[0]);
  } catch {
    return { rebalanced: false, reason: "Failed to parse AI decision" };
  }

  if (!decision.should_rebalance) {
    return { rebalanced: false, reason: decision.reason || "No rebalance needed" };
  }

  // 7. Validate the new portfolio
  const newPortfolio = decision.new_portfolio;
  if (!Array.isArray(newPortfolio) || newPortfolio.length < 1 || newPortfolio.length > 5) {
    return { rebalanced: false, reason: "AI proposed invalid portfolio size" };
  }

  const totalWeight = newPortfolio.reduce((s: number, p: { weight: number }) => s + p.weight, 0);
  if (totalWeight !== 100) {
    return { rebalanced: false, reason: `AI proposed portfolio with ${totalWeight}% total (must be 100%)` };
  }

  // Check all weights are valid increments
  for (const p of newPortfolio) {
    if (p.weight < 10 || p.weight > 100 || p.weight % 10 !== 0) {
      return { rebalanced: false, reason: `Invalid weight ${p.weight}% for ${p.fund_code}` };
    }
  }

  // 8. Apply the rebalance
  const fundCodeToId = new Map((funds || []).map(f => [f.fund_code, f.id]));

  // Delete old portfolio
  await supabase.from("mpf_reference_portfolio").delete().neq("fund_id", "00000000-0000-0000-0000-000000000000");

  // Insert new portfolio
  for (const p of newPortfolio) {
    const fund_id = fundCodeToId.get(p.fund_code);
    if (!fund_id) continue;
    await supabase.from("mpf_reference_portfolio").insert({
      fund_id,
      weight: p.weight,
      note: p.rationale,
      updated_by: "auto-rebalancer",
    });
  }

  // 9. Log the rebalance as an insight
  await supabase.from("mpf_insights").insert({
    type: "alert",
    trigger: "portfolio_rebalance",
    content_en: `Portfolio rebalanced: ${decision.reason}\n\nNew allocation:\n${newPortfolio.map((p: { fund_code: string; weight: number; rationale: string }) => `- ${p.fund_code}: ${p.weight}% — ${p.rationale}`).join("\n")}`,
    content_zh: `組合已重新調配：${decision.reason}`,
    status: "completed",
  });

  return {
    rebalanced: true,
    reason: decision.reason,
    changes: newPortfolio.map((p: { fund_code: string; weight: number; rationale: string }) => ({
      to: p.fund_code,
      weight: p.weight,
      rationale: p.rationale,
    })),
  };
}
