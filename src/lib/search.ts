import { SupabaseClient } from "@supabase/supabase-js";
import type { FAQ, MessageSource } from "@/lib/types";

export interface SearchResult {
  id: string;
  document_id: string;
  content: string;
  page_number: number;
  chunk_index: number;
  rank: number;
  doc_title: string;
  doc_category: string;
}

const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "shall",
  "should", "may", "might", "must", "can", "could", "of", "in", "to",
  "for", "with", "on", "at", "from", "by", "about", "as", "into",
  "through", "during", "before", "after", "above", "below", "between",
  "and", "but", "or", "nor", "not", "so", "yet", "both", "either",
  "neither", "each", "every", "all", "any", "few", "more", "most",
  "other", "some", "such", "no", "only", "own", "same", "than",
  "too", "very", "just", "because", "if", "when", "where", "how",
  "what", "which", "who", "whom", "this", "that", "these", "those",
  "i", "me", "my", "we", "our", "you", "your", "he", "him", "his",
  "she", "her", "it", "its", "they", "them", "their", "tell", "much",
  "please", "know", "get", "want", "need", "like", "also",
]);

/**
 * Extract meaningful keywords from a query string.
 */
export function extractKeywords(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w));
}

/**
 * Search FAQs by keyword overlap. Returns the best match if score >= threshold.
 */
export async function matchFAQ(
  supabase: SupabaseClient,
  query: string,
  threshold = 0.6
): Promise<{ faq: FAQ; score: number } | null> {
  const queryKeywords = extractKeywords(query);
  if (queryKeywords.length === 0) return null;

  const { data: faqs, error: faqsError } = await supabase.from("faqs").select("*");
  if (faqsError) console.error("[search] Failed to fetch FAQs:", faqsError);
  if (!faqs || faqs.length === 0) return null;

  let bestMatch: { faq: FAQ; score: number } | null = null;

  for (const faq of faqs as FAQ[]) {
    const faqKeywords = new Set(faq.keywords);
    let overlap = 0;
    for (const kw of queryKeywords) {
      if (faqKeywords.has(kw)) overlap++;
    }
    // Score: what fraction of query keywords match FAQ keywords
    const score = overlap / queryKeywords.length;
    if (score >= threshold && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { faq, score };
    }
  }

  return bestMatch;
}

/**
 * Search documents using keyword matching.
 */
export async function searchDocuments(
  supabase: SupabaseClient,
  query: string,
  options?: {
    matchCount?: number;
    filterCategories?: string[];
  }
): Promise<SearchResult[]> {
  const keywords = extractKeywords(query);

  if (keywords.length === 0) {
    return [];
  }

  const matchCount = options?.matchCount || 10;

  // Strategy: search by content keywords + title-matched document chunks, merge results
  const contentConditions = keywords.map((kw) => `content.ilike.%${kw}%`).join(",");

  const chunkSelect = `
    id,
    document_id,
    content,
    page_number,
    chunk_index,
    documents!inner (
      title,
      category,
      is_deleted,
      status
    )
  `;

  // 1. Content keyword search
  let query_builder = supabase
    .from("chunks")
    .select(chunkSelect)
    .eq("documents.is_deleted", false)
    .eq("documents.status", "indexed")
    .or(contentConditions)
    .limit(matchCount);

  // 2. Also search by document title match (finds docs even when content is in another language)
  const titleConditions = keywords.map((kw) => `title.ilike.%${kw}%`).join(",");
  const { data: titleDocs, error: titleDocsError } = await supabase
    .from("documents")
    .select("id")
    .eq("is_deleted", false)
    .eq("status", "indexed")
    .or(titleConditions)
    .limit(10);
  if (titleDocsError) console.error("[search] Failed to fetch title-matched docs:", titleDocsError);
  const titleDocIds = (titleDocs || []).map((d) => d.id);

  let titleChunks: typeof data = [];
  if (titleDocIds.length > 0) {
    const { data: tChunks, error: tChunksError } = await supabase
      .from("chunks")
      .select(chunkSelect)
      .eq("documents.is_deleted", false)
      .eq("documents.status", "indexed")
      .in("document_id", titleDocIds)
      .limit(matchCount);
    if (tChunksError) console.error("[search] Failed to fetch title-matched chunks:", tChunksError);
    titleChunks = tChunks || [];
  }

  if (options?.filterCategories && options.filterCategories.length > 0) {
    query_builder = query_builder.in(
      "documents.category",
      options.filterCategories
    );
  }

  const { data, error } = await query_builder;

  if (error) {
    console.error("Search error:", error);
  }

  // Merge content matches + title matches, deduplicate
  const seen = new Set<string>();
  const allChunks = [];
  for (const chunk of [...(data || []), ...titleChunks]) {
    if (!seen.has(chunk.id)) {
      seen.add(chunk.id);
      allChunks.push(chunk);
    }
  }

  if (allChunks.length === 0) {
    return [];
  }

  // Score results by keyword matches in content + title
  const scored = allChunks.map((chunk) => {
    const contentLower = chunk.content.toLowerCase();
    const doc = chunk.documents as unknown as {
      title: string;
      category: string;
    };
    const titleLower = doc.title.toLowerCase();
    let matchCount = 0;
    let titleMatches = 0;
    for (const kw of keywords) {
      if (contentLower.includes(kw)) matchCount++;
      // Strong boost for title matches — critical for non-English content
      // where product codes (OYS2, ECP2) appear in titles but not in Chinese content
      if (titleLower.includes(kw)) {
        titleMatches++;
        matchCount += 2;
      }
    }
    // If all keywords matched in title, guarantee a high minimum score
    const titleBonus = titleMatches === keywords.length ? 1 : 0;
    return {
      id: chunk.id,
      document_id: chunk.document_id,
      content: chunk.content,
      page_number: chunk.page_number || 1,
      chunk_index: chunk.chunk_index,
      rank: Math.max(matchCount / keywords.length, titleBonus),
      doc_title: doc.title,
      doc_category: doc.category,
    } as SearchResult;
  });

  // Sort by relevance (most keyword matches first)
  scored.sort((a, b) => b.rank - a.rank);

  return scored.slice(0, options?.matchCount || 10);
}

/**
 * Format search results into context for the LLM prompt.
 */
export function formatContextForPrompt(results: SearchResult[]): string {
  if (results.length === 0) {
    return "No relevant documents found.";
  }

  return results
    .map(
      (r, i) =>
        `[Source ${i + 1}: "${r.doc_title}", page ${r.page_number}]\n${r.content}`
    )
    .join("\n\n---\n\n");
}

/**
 * Extract source citations from search results.
 */
export function extractCitations(
  results: SearchResult[]
): {
  chunk_id: string;
  document_id: string;
  document_title: string;
  page_number: number;
  relevance_score: number;
}[] {
  const seen = new Set<string>();
  return results
    .filter((r) => {
      const key = `${r.document_id}-${r.page_number}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((r) => ({
      chunk_id: r.id,
      document_id: r.document_id,
      document_title: r.doc_title,
      page_number: r.page_number,
      relevance_score: r.rank,
    }));
}
