// src/lib/mpf/scrapers/news-collector.ts
// Fetches financial news from Google News RSS (free, real-time, no API key).
// Replaces NewsAPI.org which had 24h delay on free tier.

import { XMLParser } from "fast-xml-parser";
import { createAdminClient } from "@/lib/supabase/admin";

interface RssItem {
  title: string;
  link: string;
  pubDate: string;
  description?: string;
  source?: string | { "#text": string };
}

const QUERIES = [
  { q: "Hong Kong stock market OR Hang Seng", region: "hk" as const },
  { q: "China economy OR Shanghai composite OR yuan", region: "china" as const },
  { q: "Asia Pacific markets OR Asian stocks", region: "asia" as const },
  { q: "global markets OR Federal Reserve OR interest rates OR inflation", region: "global" as const },
  { q: "MPF OR mandatory provident fund Hong Kong", region: "hk" as const },
];

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

/**
 * Extract source name from Google News RSS item.
 * The <source> tag contains the publisher name.
 */
function extractSource(item: RssItem): string {
  if (!item.source) return "Unknown";
  if (typeof item.source === "string") return item.source;
  if (item.source["#text"]) return item.source["#text"];
  return "Unknown";
}

/**
 * Strip HTML tags from description snippet.
 */
function stripHtml(html: string | undefined): string | null {
  if (!html) return null;
  return html.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

/**
 * Fetch news from Google News RSS.
 * Free, no API key, real-time, excellent HK/Asia coverage.
 * URL: https://news.google.com/rss/search?q={query}&hl=en&gl=HK&ceid=HK:en
 */
export async function fetchNews(): Promise<number> {
  const supabase = createAdminClient();
  let totalInserted = 0;
  let dedupLoaded = false;
  let dedupSet = new Set<string>();

  for (const query of QUERIES) {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query.q)}&hl=en&gl=HK&ceid=HK:en`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    let res: Response;
    try {
      res = await fetch(url, {
        signal: controller.signal,
        redirect: "follow",
        headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
      });
    } catch {
      clearTimeout(timeout);
      console.error(`[news] Failed to fetch Google News RSS for: ${query.q}`);
      continue;
    }
    clearTimeout(timeout);

    if (!res.ok) {
      console.error(`[news] Google News RSS returned ${res.status} for: ${query.q}`);
      continue;
    }

    const xml = await res.text();
    let parsed;
    try {
      parsed = parser.parse(xml);
    } catch {
      console.error(`[news] Failed to parse XML for: ${query.q}`);
      continue;
    }

    const items: RssItem[] = parsed?.rss?.channel?.item;
    if (!Array.isArray(items)) continue;

    // Take top 5 most recent per query (5 queries × 5 = 25 articles max)
    const recent = items.slice(0, 5);

    // Batch dedup: get all existing headlines from last 48h in one query
    const existingHeadlines = new Set<string>();
    if (!dedupLoaded) {
      const twoDaysAgo = new Date(Date.now() - 48 * 3600_000).toISOString();
      const { data: existing } = await supabase
        .from("mpf_news")
        .select("headline")
        .gte("published_at", twoDaysAgo);
      for (const e of existing || []) existingHeadlines.add(e.headline);
      dedupLoaded = true;
      dedupSet = existingHeadlines;
    }

    for (const item of recent) {
      const title = String(item.title || "").trim();
      if (!title || title === "[Removed]") continue;
      if (dedupSet.has(title)) continue;

      const pubDate = item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString();
      const source = extractSource(item);
      const summary = stripHtml(item.description);
      const articleUrl = String(item.link || "");

      const { error } = await supabase.from("mpf_news").insert({
        headline: title,
        summary,
        source,
        url: articleUrl,
        published_at: pubDate,
        region: query.region,
        category: "markets",
        impact_tags: [],
        sentiment: "neutral",
        is_high_impact: false,
      });

      if (!error) {
        totalInserted++;
        dedupSet.add(title); // prevent inserting same headline from different queries
      }
    }
  }

  console.log(`[news] Google News RSS: ${totalInserted} new articles inserted`);
  return totalInserted;
}
