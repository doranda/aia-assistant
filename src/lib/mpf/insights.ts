// src/lib/mpf/insights.ts
import { createAdminClient } from "@/lib/supabase/admin";
import { INSIGHT_DISCLAIMER, FUND_CATEGORY_LABELS, IMPACT_TAG_TO_CATEGORIES } from "./constants";
import type { MpfInsight } from "./types";

/**
 * Generate an AI insight using DeepSeek V3 via Ollama Cloud.
 * Updates mpf_insights row status from pending → generating → completed/failed.
 */
export async function generateInsight(insightId: string): Promise<void> {
  const supabase = createAdminClient();
  const ollamaUrl = process.env.OLLAMA_BASE_URL || "https://ollama.com";
  const ollamaKey = process.env.OLLAMA_API_KEY;

  // Mark as generating
  const { error: genError } = await supabase
    .from("mpf_insights")
    .update({ status: "generating" })
    .eq("id", insightId);
  if (genError) console.error("[insights] Failed to set status to generating:", genError);

  try {
    // Get the insight record
    const { data: insight, error: insightError } = await supabase
      .from("mpf_insights")
      .select("*")
      .eq("id", insightId)
      .single();
    if (insightError && insightError.code !== "PGRST116") console.error("[insights] Failed to fetch insight:", insightError);

    if (!insight) throw new Error("Insight not found");

    // Gather context data
    const context = await gatherInsightContext(insight);

    // Generate English version
    const contentEn = await callDeepSeek(ollamaUrl, ollamaKey, buildPrompt(context, "en"));

    // Generate Chinese version
    const contentZh = await callDeepSeek(ollamaUrl, ollamaKey, buildPrompt(context, "zh"));

    // Determine which fund categories are covered
    const fundCategories = determineFundCategories(context);

    const { error: completedError } = await supabase
      .from("mpf_insights")
      .update({
        status: "completed",
        content_en: `${INSIGHT_DISCLAIMER.en}\n\n${contentEn}`,
        content_zh: `${INSIGHT_DISCLAIMER.zh}\n\n${contentZh}`,
        fund_categories: fundCategories,
      })
      .eq("id", insightId);
    if (completedError) console.error("[insights] Failed to set status to completed:", completedError);
  } catch (error) {
    const { error: failedError } = await supabase
      .from("mpf_insights")
      .update({
        status: "failed",
        content_en: `Generation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      })
      .eq("id", insightId);
    if (failedError) console.error("[insights] Failed to set status to failed:", failedError);
  }
}

async function gatherInsightContext(insight: MpfInsight) {
  const supabase = createAdminClient();

  // Get recent prices (last 7 days)
  const { data: recentPrices, error: pricesError } = await supabase
    .from("mpf_prices")
    .select("fund_id, date, nav, daily_change_pct, mpf_funds(fund_code, name_en, category)")
    .gte("date", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0])
    .order("date", { ascending: false });
  if (pricesError) console.error("[insights] Failed to fetch recent prices:", pricesError);

  // Get recent high-impact news (last 7 days)
  const { data: recentNews, error: newsError } = await supabase
    .from("mpf_news")
    .select("headline, summary, region, category, sentiment, impact_tags, published_at")
    .gte("published_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
    .order("published_at", { ascending: false })
    .limit(20);
  if (newsError) console.error("[insights] Failed to fetch recent news:", newsError);

  // Get top movers
  const { data: topMovers, error: moversError } = await supabase
    .from("mpf_prices")
    .select("daily_change_pct, mpf_funds(fund_code, name_en)")
    .eq("date", new Date().toISOString().split("T")[0])
    .not("daily_change_pct", "is", null)
    .order("daily_change_pct", { ascending: false })
    .limit(5);
  if (moversError) console.error("[insights] Failed to fetch top movers:", moversError);

  return {
    type: insight.type,
    trigger: insight.trigger,
    fund_ids: insight.fund_ids,
    recentPrices: recentPrices || [],
    recentNews: recentNews || [],
    topMovers: topMovers || [],
  };
}

function buildPrompt(context: Awaited<ReturnType<typeof gatherInsightContext>>, lang: "en" | "zh"): string {
  const langInstruction = lang === "zh"
    ? "Respond in Traditional Chinese (繁體中文). Use formal financial terminology."
    : "Respond in English.";

  return `You are the AIA MPF Care Profile analyst. Generate a ${context.type} insight report.

${langInstruction}

CONTEXT:
- Trigger: ${context.trigger}
- Period: Last 7 days

RECENT FUND PERFORMANCE:
${JSON.stringify(context.recentPrices.slice(0, 30), null, 2)}

TOP MOVERS TODAY:
${JSON.stringify(context.topMovers, null, 2)}

RECENT NEWS:
${JSON.stringify(context.recentNews, null, 2)}

FORMAT:
1. Market Overview (2-3 sentences)
2. Key Movements (bullet points — which funds moved, why)
3. News Impact Analysis (how news events correlate with fund movements)
4. Rebalancing Considerations (what AIA agents should discuss with clients — NOT advice, just talking points)
5. Outlook (1-2 sentences on near-term expectations)

RULES:
- This is internal reference material, NOT financial advice
- Be specific about fund names and percentage changes
- Cite news events when explaining movements
- Keep under 500 words`;
}

async function callDeepSeek(baseUrl: string, apiKey: string | undefined, prompt: string): Promise<string> {
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: "deepseek-v3",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 2000,
    }),
  });

  if (!res.ok) throw new Error(`DeepSeek API failed: ${res.status}`);

  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

function determineFundCategories(context: Awaited<ReturnType<typeof gatherInsightContext>>): string[] {
  if (context.type === "weekly") {
    return Object.keys(FUND_CATEGORY_LABELS);
  }

  // For alert insights, map impact tags → actual fund categories
  const categories = new Set<string>();
  for (const news of context.recentNews) {
    if (news.impact_tags) {
      for (const tag of news.impact_tags) {
        const mapped = IMPACT_TAG_TO_CATEGORIES[tag];
        if (mapped) mapped.forEach((c) => categories.add(c));
      }
    }
  }
  return Array.from(categories);
}
