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
 * Classify a news article using minimax-m2.5 via Ollama Cloud.
 * Fast (~1s per article).
 */
async function classifyArticle(headline: string, summary: string | null): Promise<ClassificationResult> {
  const ollamaUrl = process.env.OLLAMA_CLOUD_URL || "https://api.ollama.cloud/v1";
  const ollamaKey = process.env.OLLAMA_CLOUD_KEY;

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
- false otherwise

Only include relevant impact_tags (usually 1-3).`;

  const res = await fetch(`${ollamaUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(ollamaKey ? { Authorization: `Bearer ${ollamaKey}` } : {}),
    },
    body: JSON.stringify({
      model: "minimax-m2.5",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
    }),
  });

  if (!res.ok) throw new Error(`Ollama classification failed: ${res.status}`);

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || "";

  // Parse JSON from response (handle potential markdown wrapping)
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
 * Classify all unclassified news (placeholder sentiment=neutral, empty impact_tags).
 */
export async function classifyUnclassifiedNews(): Promise<number> {
  const supabase = createAdminClient();

  // Get news with empty impact_tags (unclassified)
  const { data: unclassified } = await supabase
    .from("mpf_news")
    .select("id, headline, summary")
    .eq("impact_tags", "{}")
    .order("published_at", { ascending: false })
    .limit(50);

  if (!unclassified?.length) return 0;

  let classified = 0;

  for (const article of unclassified) {
    try {
      const result = await classifyArticle(article.headline, article.summary);

      await supabase
        .from("mpf_news")
        .update({
          sentiment: result.sentiment,
          category: result.category,
          region: result.region,
          impact_tags: result.impact_tags,
          is_high_impact: result.is_high_impact,
        })
        .eq("id", article.id);

      classified++;
    } catch {
      // Skip failed classifications, retry next run
      continue;
    }
  }

  return classified;
}
