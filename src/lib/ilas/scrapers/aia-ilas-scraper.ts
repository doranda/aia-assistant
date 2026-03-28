// src/lib/ilas/scrapers/aia-ilas-scraper.ts
// Fetches ILAS fund prices from AIA's CorpWS API.
// Replaces the old HTML scraper — no browser, no Playwright needed.

import { createAdminClient } from "@/lib/supabase/admin";

const AIA_FUND_INFO_URL =
  "https://www1.aia.com.hk/CorpWS/Investment/Get/FundInfo2/";

interface ScrapedPrice {
  fund_code: string;
  offer_price: number;
  bid_price: number;
  valuation_date: string;
  currency: string;
  daily_change_pct: number | null;
}

/**
 * Extract numeric price from AIA's HTML-formatted price fields.
 * Example input: `<font color='#D31145'>US$[19.8800]</font>`
 * Returns: { currency: "USD", price: 19.88 }
 */
function parseHtmlPrice(raw: unknown): { currency: string; price: number } | null {
  if (!raw) return null;
  const str = String(raw);

  // Strip HTML tags and entities
  const stripped = str.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/[▼▲]/g, "").trim();
  if (!stripped) return null;

  // Match currency prefix + bracketed or plain number
  // Patterns: "US$[19.8800]", "HK$12.3400", "US$19.8800", "RMB[5.1200]", "EUR€[12.34]"
  const match = stripped.match(
    /(US\$|HK\$|RMB|EUR€?|GBP|JPY|AUD|CAD|SGD|NZD)\[?([\d.]+)\]?/
  );
  if (!match) return null;

  const price = parseFloat(match[2]);
  if (isNaN(price) || price <= 0) return null;

  // Normalise currency codes
  const currencyMap: Record<string, string> = {
    "US$": "USD",
    "HK$": "HKD",
    RMB: "RMB",
    EUR: "EUR",
    "EUR€": "EUR",
    GBP: "GBP",
    JPY: "JPY",
    AUD: "AUD",
    CAD: "CAD",
    SGD: "SGD",
    NZD: "NZD",
  };
  const currency = currencyMap[match[1]] ?? match[1];

  return { currency, price };
}

/**
 * Parse a date string from AIA API.
 * Handles: "03/27/2026" (MM/DD/YYYY) or "27/03/2026" (DD/MM/YYYY) or "2026-03-27"
 * The API uses DD/MM/YYYY format.
 * Returns: "2026-03-27" (YYYY-MM-DD)
 */
function parseValuationDate(raw: unknown): string | null {
  if (!raw) return null;
  const str = String(raw).trim();

  // Strip brackets: "[03/26/2026]" → "03/26/2026"
  const clean = str.replace(/[\[\]]/g, "").trim();

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;

  // MM/DD/YYYY (AIA CorpWS format — confirmed from API response)
  const slashMatch = clean.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (slashMatch) {
    return `${slashMatch[3]}-${slashMatch[1]}-${slashMatch[2]}`;
  }

  return null;
}

/**
 * Scrape ILAS fund prices from AIA's CorpWS API.
 * Fetches FundInfo2 for the TMP2 scheme (covers all 142 funds).
 */
export async function scrapeILASPrices(): Promise<{
  prices: ScrapedPrice[];
  errors: string[];
}> {
  const errors: string[] = [];
  const prices: ScrapedPrice[] = [];

  try {
    const url = `${AIA_FUND_INFO_URL}?fund_cat=TMP2&fund_type=&fund_house=&fund_code=&name=&lang=en`;

    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AIA-Hub/1.0)",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      errors.push(`CorpWS API returned ${res.status}: ${res.statusText}`);
      return { prices, errors };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json();

    // The API returns an array of fund objects (or wrapped in a top-level key)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items: any[] = Array.isArray(data)
      ? data
      : data?.fundList ?? data?.data ?? data?.funds ?? [];

    if (items.length === 0) {
      errors.push(
        `CorpWS API returned no funds. Response keys: ${typeof data === "object" && data ? Object.keys(data).join(", ") : typeof data}`
      );
      return { prices, errors };
    }

    for (const item of items) {
      try {
        const fundCode: string = item.code ?? item.fund_code ?? item.fundCode ?? "";
        if (!fundCode) continue;

        // Parse offer and bid prices (may contain HTML font tags)
        const offerParsed = parseHtmlPrice(
          item.offerPrice ?? item.offer_price ?? item.bidPrice ?? item.bid_price
        );
        const bidParsed = parseHtmlPrice(
          item.bidPrice ?? item.bid_price ?? item.offerPrice ?? item.offer_price
        );

        if (!offerParsed && !bidParsed) continue;

        // Parse valuation date
        const valDate = parseValuationDate(
          item.valuationDate ?? item.valuation_date ?? item.priceDate
        );
        if (!valDate) continue;

        // Daily change percentage
        const ddChange = item.dd_change ?? item.dailyChange ?? item.daily_change_pct;
        const dailyChangePct =
          ddChange !== null && ddChange !== undefined && ddChange !== ""
            ? parseFloat(String(ddChange))
            : null;

        // Currency from the parsed price, or from a dedicated field
        const currency =
          offerParsed?.currency ??
          bidParsed?.currency ??
          String(item.currency ?? "USD");

        prices.push({
          fund_code: fundCode,
          offer_price: offerParsed?.price ?? bidParsed!.price,
          bid_price: bidParsed?.price ?? offerParsed!.price,
          valuation_date: valDate,
          currency,
          daily_change_pct:
            dailyChangePct !== null && !isNaN(dailyChangePct)
              ? dailyChangePct
              : null,
        });
      } catch (itemErr) {
        errors.push(
          `Failed to parse fund ${item.fund_code ?? "unknown"}: ${itemErr instanceof Error ? itemErr.message : "Unknown"}`
        );
      }
    }

    if (prices.length === 0) {
      errors.push(
        `Parsed 0 prices from ${items.length} API records — check response format`
      );
    } else {
      console.log(
        `[ilas-scraper] Parsed ${prices.length} prices from ${items.length} API records`
      );
    }

    return { prices, errors };
  } catch (err) {
    errors.push(
      `Scrape failed: ${err instanceof Error ? err.message : "Unknown"}`
    );
    return { prices, errors };
  }
}

/**
 * Upsert scraped prices into ilas_prices.
 * Computes daily_change_pct by comparing to previous day's NAV.
 */
export async function upsertIlasPrices(
  scrapedPrices: ScrapedPrice[]
): Promise<{ inserted: number; errors: number }> {
  const supabase = createAdminClient();
  let inserted = 0;
  let errCount = 0;

  const { data: funds, error: fundsErr } = await supabase
    .from("ilas_funds")
    .select("id, fund_code");
  if (fundsErr)
    console.error(
      "[ilas-scraper] Failed to fetch funds:",
      fundsErr.message
    );
  const fundMap = new Map((funds || []).map((f) => [f.fund_code, f.id]));

  // Group by date
  const dateGroups = new Map<string, ScrapedPrice[]>();
  for (const p of scrapedPrices) {
    if (!dateGroups.has(p.valuation_date))
      dateGroups.set(p.valuation_date, []);
    dateGroups.get(p.valuation_date)!.push(p);
  }

  for (const [date, group] of dateGroups) {
    // Previous day's prices for daily change
    const { data: prevPrices, error: prevErr } = await supabase
      .from("ilas_prices")
      .select("fund_id, nav")
      .lt("date", date)
      .order("date", { ascending: false })
      .limit(200);
    if (prevErr)
      console.error(
        "[ilas-scraper] Failed to fetch previous prices:",
        prevErr.message
      );

    const prevMap = new Map<string, number>();
    for (const pp of prevPrices || []) {
      if (!prevMap.has(pp.fund_id)) prevMap.set(pp.fund_id, pp.nav);
    }

    const rows = [];
    const skippedCodes: string[] = [];
    for (const p of group) {
      const fundId = fundMap.get(p.fund_code);
      if (!fundId) {
        skippedCodes.push(p.fund_code);
        continue;
      }

      const prevNav = prevMap.get(fundId);
      const dailyChange =
        prevNav && prevNav > 0
          ? ((p.bid_price - prevNav) / prevNav) * 100
          : null;

      rows.push({
        fund_id: fundId,
        date,
        nav: p.bid_price,
        daily_change_pct: dailyChange
          ? parseFloat(dailyChange.toFixed(4))
          : null,
        source: "aia_api",
      });
    }

    if (skippedCodes.length > 0) {
      console.warn(
        `[ilas-scraper] Skipped ${skippedCodes.length} unknown codes: ${skippedCodes.join(", ")}`
      );
    }

    // Upsert in chunks of 50 to avoid payload size limits
    const CHUNK_SIZE = 50;
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      const { error } = await supabase
        .from("ilas_prices")
        .upsert(chunk, { onConflict: "fund_id,date" });

      if (error) {
        console.error(
          `[ilas-scraper] Chunk ${i}-${i + chunk.length} failed:`,
          error.code,
          error.message
        );
        errCount += chunk.length;
      } else {
        inserted += chunk.length;
      }
    }
  }

  return { inserted, errors: errCount };
}

/**
 * Full scrape + upsert pipeline. Called by the price cron.
 */
export async function runILASPriceScrape(): Promise<{
  scraped: number;
  inserted: number;
  errors: string[];
}> {
  const { prices, errors } = await scrapeILASPrices();

  if (prices.length === 0) {
    return { scraped: 0, inserted: 0, errors };
  }

  const { inserted, errors: upsertErrors } = await upsertIlasPrices(prices);
  if (upsertErrors > 0) {
    errors.push(`${upsertErrors} upsert errors`);
  }

  // Log scraper run
  const supabase = createAdminClient();
  const { error: logErr } = await supabase.from("scraper_runs").insert({
    scraper_name: "ilas_prices",
    status: errors.length === 0 ? "success" : "partial",
    records_processed: inserted,
    error_message: errors.length > 0 ? errors.join("; ") : null,
  });
  if (logErr)
    console.error(
      "[ilas-scraper] Failed to log scraper run:",
      logErr.message
    );

  return { scraped: prices.length, inserted, errors };
}
