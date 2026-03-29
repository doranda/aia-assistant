// src/lib/mpf/classification.ts
import { createAdminClient } from "@/lib/supabase/admin";
import type { NewsCategory, NewsRegion, Sentiment } from "./types";

interface ClassificationResult {
  sentiment: Sentiment;
  category: NewsCategory;
  region: NewsRegion;
  impact_tags: string[];
  is_high_impact: boolean;
}

/**
 * Classify a news article using OpenRouter (fast, ~1-2s per article).
 * Falls back to Ollama if OPENROUTER_API_KEY not set.
 */
async function classifyArticle(headline: string, summary: string | null): Promise<ClassificationResult> {
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  const apiUrl = openRouterKey
    ? "https://openrouter.ai/api/v1/chat/completions"
    : `${process.env.OLLAMA_BASE_URL || "https://ollama.com"}/v1/chat/completions`;
  const apiKey = openRouterKey || process.env.OLLAMA_API_KEY;
  const model = openRouterKey
    ? "nvidia/nemotron-3-super-120b-a12b:free"
    : (process.env.OLLAMA_CHAT_MODEL || "ministral-3:8b");

  const prompt = `Classify this financial news article. Return ONLY valid JSON, no markdown.

Headline: ${headline}
${summary ? `Summary: ${summary}` : ""}

Return JSON with these exact fields:
{
  "sentiment": "positive" | "negative" | "neutral",
  "category": "markets" | "geopolitical" | "policy" | "macro",
  "region": "global" | "asia" | "hk" | "china",
  "impact_tags": ["hk_equity", "asia_equity", "us_equity", "eu_equity", "global_equity", "bond", "fx", "rates", "china", "green_esg"],
  "is_high_impact": true | false
}

Rules for is_high_impact:
- true if sentiment=negative AND impact_tags has 3+ items
- true if category=policy AND region is hk or china
- true if about war, sanctions, major central bank decisions, currency crisis
- false otherwise

Only include relevant impact_tags (usually 1-3).`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...(openRouterKey ? { "HTTP-Referer": "https://aia-assistant.vercel.app" } : {}),
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
    }),
    signal: controller.signal,
  });

  clearTimeout(timeout);

  if (!res.ok) throw new Error(`Classification failed: ${res.status}`);

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || "";

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { sentiment: "neutral", category: "markets", region: "global", impact_tags: [], is_high_impact: false };
  }

  const parsed = JSON.parse(jsonMatch[0]);

  return {
    sentiment: parsed.sentiment || "neutral",
    category: parsed.category || "markets",
    region: parsed.region || "global",
    impact_tags: Array.isArray(parsed.impact_tags) ? parsed.impact_tags : [],
    is_high_impact: parsed.is_high_impact === true,
  };
}

/**
 * Classify all unclassified news articles.
 * Returns count of newly classified articles and whether any are high-impact.
 */
export async function classifyUnclassifiedNews(): Promise<{ classified: number; highImpactCount: number }> {
  const supabase = createAdminClient();

  const { data: unclassified, error: fetchError } = await supabase
    .from("mpf_news")
    .select("id, headline, summary")
    .eq("impact_tags", "{}")
    .order("published_at", { ascending: false })
    .limit(5);
  if (fetchError) console.error("[classification] failed to fetch unclassified news:", fetchError.message);

  if (!unclassified?.length) return { classified: 0, highImpactCount: 0 };

  // Classify in parallel for speed
  const results = await Promise.allSettled(
    unclassified.map(async (article) => {
      const result = await classifyArticle(article.headline, article.summary);
      const { error: updateErr } = await supabase
        .from("mpf_news")
        .update({
          sentiment: result.sentiment,
          category: result.category,
          region: result.region,
          impact_tags: result.impact_tags,
          is_high_impact: result.is_high_impact,
        })
        .eq("id", article.id);
      if (updateErr) console.error(`[classification] update error for ${article.id}:`, updateErr);
      return result;
    })
  );

  let classified = 0;
  let highImpactCount = 0;
  for (const r of results) {
    if (r.status === "fulfilled") {
      classified++;
      if (r.value.is_high_impact) highImpactCount++;
    }
  }

  return { classified, highImpactCount };
}
