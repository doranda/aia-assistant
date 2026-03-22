// src/lib/mpf/scrapers/fund-prices.ts
import * as cheerio from "cheerio";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PriceSource } from "../types";

interface ScrapedPrice {
  fund_code: string;
  date: string; // YYYY-MM-DD
  nav: number;
  source: PriceSource;
}

// Static lookup: AAStocks fund display names → our internal fund codes.
// UPDATE this map if AAStocks changes their fund naming.
const AASTOCKS_NAME_TO_CODE: Record<string, string> = {
  "Asian Equity Fund": "AIA-AEF",
  "European Equity Fund": "AIA-EEF",
  "Greater China Equity Fund": "AIA-GCF",
  "Hong Kong Equity Fund": "AIA-HEF",
  "Japan Equity Fund": "AIA-JEF",
  "North American Equity Fund": "AIA-NAF",
  "Green Fund": "AIA-GRF",
  "American Index Tracking Fund": "AIA-AMI",
  "Eurasia Index Tracking Fund": "AIA-EAI",
  "Hong Kong and China Index Tracking Fund": "AIA-HCI",
  "World Index Tracking Fund": "AIA-WIF",
  "Growth Fund": "AIA-GRW",
  "Balanced Fund": "AIA-BAL",
  "Capital Stable Fund": "AIA-CST",
  "China Hong Kong Dynamic Fund": "AIA-CHD",
  "Manager's Choice Fund": "AIA-MCF",
  "Fidelity Growth Fund": "AIA-FGR",
  "Fidelity Stable Growth Fund": "AIA-FSG",
  "Fidelity Capital Stable Fund": "AIA-FCS",
  "Asian Bond Fund": "AIA-ABF",
  "Global Bond Fund": "AIA-GBF",
  "MPF Conservative Fund": "AIA-CON",
  "Guaranteed Portfolio": "AIA-GPF",
  "Core Accumulation Fund": "AIA-CAF",
  "Age 65 Plus Fund": "AIA-65P",
};

/**
 * Match scraped fund name to internal fund code using static lookup.
 * Falls back to fuzzy match on key words.
 */
function matchFundCode(scrapedName: string): string | null {
  // Exact match first
  const exact = AASTOCKS_NAME_TO_CODE[scrapedName];
  if (exact) return exact;

  // Fuzzy: check if any lookup key is contained in the scraped name
  const lower = scrapedName.toLowerCase();
  for (const [displayName, code] of Object.entries(AASTOCKS_NAME_TO_CODE)) {
    if (lower.includes(displayName.toLowerCase())) return code;
  }

  return null;
}

/**
 * Scrape AAStocks MPF fund prices page.
 * This is the SECONDARY source — used when MPFA Excel is unavailable.
 */
export async function scrapeAAStocksPrices(): Promise<ScrapedPrice[]> {
  const prices: ScrapedPrice[] = [];

  // AAStocks MPF overview page lists all AIA funds
  const res = await fetch("https://www.aastocks.com/en/mpf/fundlist.aspx?t=1&s=AIA", {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; AIA-Hub/1.0)" },
  });

  if (!res.ok) {
    throw new Error(`AAStocks fetch failed: ${res.status}`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  // Parse fund table rows — structure may change, log HTML for debugging
  // Each row: fund name | NAV | date | 1D change
  $("table.mpf-fund-table tr").each((_i, row) => {
    const cells = $(row).find("td");
    if (cells.length < 4) return;

    const name = $(cells[0]).text().trim();
    const navText = $(cells[1]).text().trim();
    const dateText = $(cells[2]).text().trim();

    const nav = parseFloat(navText.replace(/[^0-9.]/g, ""));
    if (isNaN(nav)) return;

    // Match to our fund code via static lookup
    const fundCode = matchFundCode(name);
    if (!fundCode) return;

    // Parse date (format: DD/MM/YYYY → YYYY-MM-DD)
    const [dd, mm, yyyy] = dateText.split("/");
    if (!dd || !mm || !yyyy) return;
    const date = `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;

    prices.push({ fund_code: fundCode, date, nav, source: "aastocks" });
  });

  return prices;
}

/**
 * Upsert scraped prices into mpf_prices table.
 * Calculates daily_change_pct from previous day's NAV.
 */
export async function upsertPrices(prices: ScrapedPrice[]): Promise<number> {
  if (prices.length === 0) return 0;

  const supabase = createAdminClient();

  // Get fund_id map
  const { data: funds } = await supabase
    .from("mpf_funds")
    .select("id, fund_code");

  const fundMap = new Map(funds?.map((f) => [f.fund_code, f.id]) || []);

  let upserted = 0;

  for (const price of prices) {
    const fund_id = fundMap.get(price.fund_code);
    if (!fund_id) continue;

    // Get previous day's NAV for daily_change_pct
    const { data: prev } = await supabase
      .from("mpf_prices")
      .select("nav")
      .eq("fund_id", fund_id)
      .lt("date", price.date)
      .order("date", { ascending: false })
      .limit(1)
      .single();

    const daily_change_pct = prev?.nav
      ? Number((((price.nav - prev.nav) / prev.nav) * 100).toFixed(4))
      : null;

    const { error } = await supabase
      .from("mpf_prices")
      .upsert(
        { fund_id, date: price.date, nav: price.nav, daily_change_pct, source: price.source },
        { onConflict: "fund_id,date" }
      );

    if (!error) upserted++;
  }

  return upserted;
}
