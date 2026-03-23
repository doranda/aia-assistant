// src/lib/mpf/scrapers/news-collector.ts
import { createAdminClient } from "@/lib/supabase/admin";

interface NewsApiArticle {
  title: string;
  description: string | null;
  source: { name: string };
  url: string;
  publishedAt: string;
}

interface NewsApiResponse {
  status: string;
  totalResults: number;
  articles: NewsApiArticle[];
}

const QUERIES = [
  { q: "Hong Kong stock market OR Hang Seng", region: "hk" as const },
  { q: "China economy OR Shanghai composite OR yuan", region: "china" as const },
  { q: "Asia Pacific markets OR Asian stocks", region: "asia" as const },
  { q: "global markets OR Federal Reserve OR interest rates OR inflation", region: "global" as const },
  { q: "MPF OR mandatory provident fund", region: "hk" as const },
];

/**
 * Fetch news from NewsAPI.org.
 * Requires NEWSAPI_KEY env var.
 * Free tier: 100 requests/day, business plan: unlimited.
 */
export async function fetchNews(): Promise<number> {
  const apiKey = process.env.NEWSAPI_KEY;
  if (!apiKey) throw new Error("NEWSAPI_KEY not set");

  const supabase = createAdminClient();
  let totalInserted = 0;

  for (const query of QUERIES) {
    const url = new URL("https://newsapi.org/v2/everything");
    url.searchParams.set("q", query.q);
    url.searchParams.set("language", "en");
    url.searchParams.set("sortBy", "publishedAt");
    url.searchParams.set("pageSize", "10");
    url.searchParams.set("apiKey", apiKey);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let res: Response;
    try {
      res = await fetch(url.toString(), { signal: controller.signal });
    } catch {
      clearTimeout(timeout);
      continue;
    }
    clearTimeout(timeout);
    if (!res.ok) continue;

    const data: NewsApiResponse = await res.json();
    if (data.status !== "ok") continue;

    for (const article of data.articles) {
      if (!article.title || article.title === "[Removed]") continue;

      // Dedup by headline + published_at (same headline within 1 hour = duplicate)
      const pubTime = new Date(article.publishedAt);
      const hourBefore = new Date(pubTime.getTime() - 3600_000).toISOString();
      const hourAfter = new Date(pubTime.getTime() + 3600_000).toISOString();
      const { count } = await supabase
        .from("mpf_news")
        .select("*", { count: "exact", head: true })
        .eq("headline", article.title)
        .gte("published_at", hourBefore)
        .lte("published_at", hourAfter);

      if (count && count > 0) continue;

      // Insert with placeholder classification (will be classified by AI in next step)
      const { error } = await supabase.from("mpf_news").insert({
        headline: article.title,
        summary: article.description,
        source: article.source.name,
        url: article.url,
        published_at: article.publishedAt,
        region: query.region,
        category: "markets", // placeholder — AI classifies next
        impact_tags: [],
        sentiment: "neutral", // placeholder
        is_high_impact: false,
      });

      if (!error) totalInserted++;
    }
  }

  return totalInserted;
}
