// src/lib/mpf/scrapers/fund-prices.ts
import * as XLSX from "xlsx";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PriceSource } from "../types";

interface ScrapedPrice {
  fund_code: string;
  date: string; // YYYY-MM-DD
  nav: number;
  source: PriceSource;
}

// MPFA Excel fund names → our internal fund codes.
// MPFA uses slightly different names than our constants (e.g. "American Fund" vs "American Index Fund").
const MPFA_NAME_TO_CODE: Record<string, string> = {
  "Age 65 Plus Fund": "AIA-65P",
  "American Fund": "AIA-AMI",
  "Asian Bond Fund": "AIA-ABF",
  "Asian Equity Fund": "AIA-AEF",
  "Balanced Portfolio": "AIA-BAL",
  "Capital Stable Portfolio": "AIA-CST",
  "China HK Dynamic Asset Allocation Fund": "AIA-CHD",
  "Core Accumulation Fund": "AIA-CAF",
  "Eurasia Fund": "AIA-EAI",
  "European Equity Fund": "AIA-EEF",
  "Global Bond Fund": "AIA-GBF",
  "Greater China Equity Fund": "AIA-GCF",
  "Green Fund": "AIA-GRF",
  "Growth Portfolio": "AIA-GRW",
  "Guaranteed Portfolio": "AIA-GPF",
  "Hong Kong and China Fund": "AIA-HCI",
  "Hong Kong Equity Fund": "AIA-HEF",
  "Japan Equity Fund": "AIA-JEF",
  "Manager's Choice Fund": "AIA-MCF",
  "MPF Conservative Fund": "AIA-CON",
  "North American Equity Fund": "AIA-NAF",
  "World Fund": "AIA-WIF",
  // Fidelity funds — MPFA may list under different names
  "Fidelity Growth Fund": "AIA-FGR",
  "Fidelity Stable Growth Fund": "AIA-FSG",
  "Fidelity Capital Stable Fund": "AIA-FCS",
};

/**
 * Match scraped fund name to internal fund code.
 * Tries exact match first, then fuzzy containment.
 */
function matchFundCode(scrapedName: string): string | null {
  const exact = MPFA_NAME_TO_CODE[scrapedName];
  if (exact) return exact;

  const lower = scrapedName.toLowerCase();
  for (const [displayName, code] of Object.entries(MPFA_NAME_TO_CODE)) {
    if (lower.includes(displayName.toLowerCase())) return code;
  }

  return null;
}

/**
 * Build MPFA Excel URL for a given month.
 * Format: consolidated_list_for_{mon}_{yy}_read_only.xls
 * MPFA publishes by mid of the following month.
 */
function getMPFAExcelUrl(year: number, month: number): string {
  const monthNames = [
    "jan", "feb", "mar", "apr", "may", "jun",
    "jul", "aug", "sep", "oct", "nov", "dec",
  ];
  const mon = monthNames[month - 1];
  const yy = String(year).slice(-2);
  return `https://www.mpfa.org.hk/en/-/media/files/information-centre/fund-information/monthly-fund-price/consolidated_list_for_${mon}_${yy}_read_only.xls`;
}

/**
 * Parse MPFA Excel workbook and extract AIA fund prices.
 * Returns prices with the valuation date from the header.
 */
function parseExcel(buffer: ArrayBuffer): { prices: ScrapedPrice[]; date: string } {
  const wb = XLSX.read(new Uint8Array(buffer), { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data: (string | number | null)[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });

  // Extract date from header row (row index 4): "as at DD.MM.YYYY"
  let dateStr = "";
  const headerRow = data[4];
  if (headerRow) {
    const dateCell = String(headerRow[3] || "");
    const match = dateCell.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    if (match) {
      dateStr = `${match[3]}-${match[2]}-${match[1]}`; // YYYY-MM-DD
    }
  }

  if (!dateStr) {
    // Fallback: try title row for month/year
    const title = String(data[0]?.[0] || "");
    const m = title.match(/\((\w+)\s+(\d{4})\)/);
    if (m) {
      const monthMap: Record<string, string> = {
        January: "01", February: "02", March: "03", April: "04",
        May: "05", June: "06", July: "07", August: "08",
        September: "09", October: "10", November: "11", December: "12",
      };
      const mm = monthMap[m[1]] || "01";
      dateStr = `${m[2]}-${mm}-28`; // Use end of month as fallback
    }
  }

  // Find AIA section boundaries
  let aiaStart = -1;
  let aiaEnd = data.length;

  for (let i = 7; i < data.length; i++) {
    const row = data[i];
    if (!row) continue;
    const col0 = row[0];
    if (typeof col0 === "string" && col0.trim()) {
      if (col0.includes("AIA") && aiaStart === -1) {
        aiaStart = i;
      } else if (aiaStart !== -1 && !col0.includes("AIA") && !col0.includes("友邦")) {
        aiaEnd = i;
        break;
      }
    }
  }

  const prices: ScrapedPrice[] = [];

  for (let i = aiaStart; i < aiaEnd; i++) {
    const row = data[i];
    if (!row) continue;

    const fundName = row[2];
    const nav = row[3];

    if (typeof fundName === "string" && typeof nav === "number") {
      const fundCode = matchFundCode(fundName);
      if (fundCode) {
        prices.push({ fund_code: fundCode, date: dateStr, nav, source: "mpfa" });
      }
    }
  }

  return { prices, date: dateStr };
}

/**
 * Fetch and parse MPFA monthly fund prices.
 * PRIMARY source — published monthly by MPFA with all AIA fund NAVs.
 * Tries current month first, falls back to previous month.
 */
export async function scrapeMPFAPrices(): Promise<ScrapedPrice[]> {
  const now = new Date();
  // MPFA publishes by mid-month for previous month
  // Try previous month first (more likely to be available)
  const attempts = [
    { year: now.getFullYear(), month: now.getMonth() }, // previous month (getMonth is 0-indexed)
    { year: now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear(), month: now.getMonth() === 0 ? 12 : now.getMonth() },
  ];

  // Adjust: getMonth() is 0-indexed, so getMonth() gives prev month number in 1-indexed
  // Actually: if now is March (getMonth()=2), prev month = Feb = month 2
  const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth();
  const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const twoMonthsAgo = prevMonth === 1 ? 12 : prevMonth - 1;
  const twoMonthsYear = prevMonth === 1 ? prevYear - 1 : prevYear;

  const urls = [
    getMPFAExcelUrl(prevYear, prevMonth),
    getMPFAExcelUrl(twoMonthsYear, twoMonthsAgo),
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; AIA-Hub/1.0)" },
      });

      if (!res.ok) continue;

      const buffer = await res.arrayBuffer();
      const { prices, date } = parseExcel(buffer);

      if (prices.length > 0) {
        console.log(`[MPFA] Parsed ${prices.length} AIA funds for ${date} from ${url}`);
        return prices;
      }
    } catch (err) {
      console.error(`[MPFA] Failed to fetch ${url}:`, err);
      continue;
    }
  }

  return [];
}

// Keep AAStocks as legacy export name for backward compat with cron route
export const scrapeAAStocksPrices = scrapeMPFAPrices;

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
