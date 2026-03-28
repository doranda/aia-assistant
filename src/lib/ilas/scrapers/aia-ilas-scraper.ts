// src/lib/ilas/scrapers/aia-ilas-scraper.ts
// Scrapes ILAS fund prices from AIA website.
// The ILAP API (getFundPerformance/ILAP/) returns 400, so we scrape the HTML page.

import { createAdminClient } from "@/lib/supabase/admin";

const AIA_FUND_PAGE =
  "https://www.aia.com.hk/en/help-and-support/individuals/investment-information/investment-options-prices.html";

interface ScrapedPrice {
  fund_code: string;
  offer_price: number;
  bid_price: number;
  valuation_date: string;
  currency: string;
  daily_change_pct: number | null;
}

function parsePrice(raw: string): { currency: string; price: number } | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[▼▲\s]/g, "").trim();
  const match = cleaned.match(/^(US\$|HK\$|RMB|EUR|GBP|JPY|AUD)(.+)$/);
  if (!match) return null;
  const price = parseFloat(match[2]);
  if (isNaN(price)) return null;
  return { currency: match[1], price };
}

function parseValuationDate(raw: string): string | null {
  if (!raw) return null;
  const match = raw.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  return `${match[3]}-${match[1]}-${match[2]}`;
}

/**
 * Scrape prices from the AIA website HTML table.
 * The page renders fund data server-side but may also load via AJAX.
 */
export async function scrapeILASPrices(): Promise<{
  prices: ScrapedPrice[];
  errors: string[];
}> {
  const errors: string[] = [];
  const prices: ScrapedPrice[] = [];

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const res = await fetch(AIA_FUND_PAGE, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      errors.push(`AIA page returned ${res.status}`);
      return { prices, errors };
    }

    const html = await res.text();

    // Parse table rows from server-rendered HTML
    const allRows = html.match(/<tbody[\s\S]*?<\/tbody>/gi) || [];
    if (allRows.length > 0) {
      const trRegex = /<tr[^>]*>[\s\S]*?<\/tr>/gi;
      const trs = (allRows[0] ?? "").match(trRegex) || [];
      for (const tr of trs) {
        const cells: string[] = [];
        const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let m;
        while ((m = tdRegex.exec(tr)) !== null) {
          cells.push(m[1].replace(/<[^>]*>/g, "").trim());
        }
        if (cells.length >= 6) {
          const code = cells[1]?.trim();
          const offerParsed = parsePrice(cells[3]);
          const bidParsed = parsePrice(cells[4]);
          const date = parseValuationDate(cells[5]);

          if (code && offerParsed && date) {
            prices.push({
              fund_code: code,
              offer_price: offerParsed.price,
              bid_price: bidParsed?.price || offerParsed.price,
              valuation_date: date,
              currency: offerParsed.currency,
              daily_change_pct: null,
            });
          }
        }
      }
    }

    if (prices.length === 0) {
      errors.push("No prices found in HTML — page likely loads data via AJAX (needs Playwright)");
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
  if (fundsErr) console.error("[ilas-scraper] Failed to fetch funds:", fundsErr.message);
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
    if (prevErr) console.error("[ilas-scraper] Failed to fetch previous prices:", prevErr.message);

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
        source: "aia_website",
      });
    }

    if (skippedCodes.length > 0) {
      console.warn(`[ilas-scraper] Skipped ${skippedCodes.length} unknown codes: ${skippedCodes.join(", ")}`);
    }

    // Upsert in chunks of 50 to avoid payload size limits
    const CHUNK_SIZE = 50;
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      const { error } = await supabase
        .from("ilas_prices")
        .upsert(chunk, { onConflict: "fund_id,date" });

      if (error) {
        console.error(`[ilas-scraper] Chunk ${i}-${i + chunk.length} failed:`, error.code, error.message);
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
    errors.push("No prices scraped. Page may require JS rendering.");
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
  if (logErr) console.error("[ilas-scraper] Failed to log scraper run:", logErr.message);

  return { scraped: prices.length, inserted, errors };
}
