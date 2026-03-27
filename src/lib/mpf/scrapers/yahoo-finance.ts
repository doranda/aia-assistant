// src/lib/mpf/scrapers/yahoo-finance.ts — Yahoo Finance CSV download for AIA MPF fund prices
// Endpoint: https://query1.finance.yahoo.com/v7/finance/download/{TICKER}
// Returns CSV with: Date,Open,High,Low,Close,Adj Close,Volume
// For MPF funds, Close = NAV

import { createAdminClient } from "@/lib/supabase/admin";

// Fund code -> Yahoo Finance ticker mapping
// Multiple tickers per fund in priority order — tries each until one works
const YAHOO_TICKERS: Record<string, string[]> = {
  "AIA-FGR": ["0P0000SI0V.HK", "AIAMPFPVCFID.HK"],
  "AIA-JEF": ["0P00008SSI.HK", "F0HKG06ZVK.HK"],
  "AIA-HEF": ["AIAMPFPVCHON.HK"],
  "AIA-FSG": ["0P0000SI0W.HK", "0P0000SI0X.HK"],  // Pattern-based guess
  "AIA-FCS": ["0P0000SI0U.HK", "0P0000SI0T.HK"],  // Pattern-based guess
};

/**
 * Fetch historical NAV prices from Yahoo Finance for missing AIA MPF funds.
 * Downloads CSV data, parses it, and upserts into mpf_prices.
 *
 * @param fundCodes - Optional subset of fund codes to fetch. Defaults to all mapped funds.
 * @returns Total number of price records upserted.
 */
export async function fetchYahooFinancePrices(fundCodes?: string[]): Promise<number> {
  const supabase = createAdminClient();
  const codes = fundCodes || Object.keys(YAHOO_TICKERS);
  let totalInserted = 0;

  for (const fundCode of codes) {
    const tickers = YAHOO_TICKERS[fundCode];
    if (!tickers?.length) continue;

    // Get fund_id
    const { data: fund } = await supabase
      .from("mpf_funds")
      .select("id")
      .eq("fund_code", fundCode)
      .single();
    if (!fund) {
      console.log(`[yahoo] ${fundCode}: fund not found in mpf_funds`);
      continue;
    }

    // Get latest existing price date to only fetch new data
    const { data: latestPrice } = await supabase
      .from("mpf_prices")
      .select("date")
      .eq("fund_id", fund.id)
      .order("date", { ascending: false })
      .limit(1)
      .single();

    // period1: start from day after latest date, or 2000-01-01 for full backfill
    const startDate = latestPrice
      ? Math.floor(new Date(latestPrice.date).getTime() / 1000) + 86400
      : 946684800; // 2000-01-01
    const endDate = Math.floor(Date.now() / 1000);

    if (startDate >= endDate) {
      console.log(`[yahoo] ${fundCode}: already up to date`);
      continue;
    }

    // Try each ticker until one works
    let fetched = false;
    for (const ticker of tickers) {
      if (fetched) break;

      try {
        // Try chart API first (more reliable, no cookie issues)
        const chartCount = await fetchFromChartAPI(supabase, fund.id, fundCode, ticker, startDate, endDate);
        if (chartCount > 0) {
          totalInserted += chartCount;
          fetched = true;
          break;
        }

        // Fallback to CSV download
        const url = `https://query1.finance.yahoo.com/v7/finance/download/${encodeURIComponent(ticker)}?period1=${startDate}&period2=${endDate}&interval=1d&events=history`;
        const res = await fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
          signal: AbortSignal.timeout(15000),
        });

        if (!res.ok) {
          console.log(`[yahoo] ${fundCode} (${ticker}): HTTP ${res.status}, trying next ticker`);
          continue;
        }

        const csv = await res.text();
        const lines = csv.trim().split("\n");

        if (lines.length < 2) {
          console.log(`[yahoo] ${fundCode} (${ticker}): no data rows, trying next`);
          continue;
        }

        const rows: { fund_id: string; date: string; nav: number; daily_change_pct: number | null; source: string }[] = [];
      let prevNav: number | null = null;

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",");
        if (cols.length < 5) continue;

        const date = cols[0]; // YYYY-MM-DD
        const close = parseFloat(cols[4]); // Close price = NAV

        if (isNaN(close) || close < 0.5 || close > 10000) continue;
        if (date === "null" || !date.match(/^\d{4}-\d{2}-\d{2}$/)) continue;

        const dailyChange = prevNav ? ((close - prevNav) / prevNav) * 100 : null;
        prevNav = close;

        rows.push({
          fund_id: fund.id,
          date,
          nav: close,
          daily_change_pct: dailyChange,
          source: "yahoo_finance",
        });
      }

      if (rows.length === 0) continue;

      // Batch upsert (chunks of 500)
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500);
        const { error } = await supabase
          .from("mpf_prices")
          .upsert(chunk, { onConflict: "fund_id,date", ignoreDuplicates: true });

        if (error) {
          console.error(`[yahoo] ${fundCode} upsert error:`, error.message);
        }
      }

      totalInserted += rows.length;
      fetched = true;
      console.log(`[yahoo] ${fundCode} (${ticker}): ${rows.length} prices from ${rows[0].date} to ${rows[rows.length - 1].date}`);
      } catch (err) {
        console.error(`[yahoo] ${fundCode} (${ticker}) error:`, err);
      }
    } // end ticker loop

    if (!fetched) {
      console.log(`[yahoo] ${fundCode}: all tickers exhausted, no data fetched`);
    }
  }

  return totalInserted;
}

/**
 * Fallback: fetch prices from Yahoo Finance v8 chart API (JSON).
 * Used when the CSV download endpoint returns 401/403 (crumb/cookie required).
 */
async function fetchFromChartAPI(
  supabase: ReturnType<typeof createAdminClient>,
  fundId: string,
  fundCode: string,
  ticker: string,
  period1: number,
  period2: number,
): Promise<number> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1d`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    console.error(`[yahoo] ${fundCode} chart API: HTTP ${res.status}`);
    return 0;
  }

  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) {
    console.log(`[yahoo] ${fundCode} chart API: no result`);
    return 0;
  }

  const timestamps: number[] = result.timestamp || [];
  const closes: (number | null)[] = result.indicators?.quote?.[0]?.close || [];

  if (timestamps.length === 0) {
    console.log(`[yahoo] ${fundCode} chart API: no timestamps`);
    return 0;
  }

  const rows: { fund_id: string; date: string; nav: number; daily_change_pct: number | null; source: string }[] = [];
  let prevNav: number | null = null;

  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i];
    if (close === null || close === undefined || isNaN(close) || close < 0.5 || close > 10000) continue;

    const date = new Date(timestamps[i] * 1000).toISOString().split("T")[0];
    if (!date.match(/^\d{4}-\d{2}-\d{2}$/)) continue;

    const dailyChange = prevNav ? ((close - prevNav) / prevNav) * 100 : null;
    prevNav = close;

    rows.push({
      fund_id: fundId,
      date,
      nav: close,
      daily_change_pct: dailyChange,
      source: "yahoo_finance",
    });
  }

  if (rows.length === 0) return 0;

  // Batch upsert (chunks of 500)
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await supabase
      .from("mpf_prices")
      .upsert(chunk, { onConflict: "fund_id,date", ignoreDuplicates: true });

    if (error) {
      console.error(`[yahoo] ${fundCode} chart upsert error:`, error.message);
    }
  }

  console.log(`[yahoo] ${fundCode} (chart): ${rows.length} prices from ${rows[0].date} to ${rows[rows.length - 1].date}`);
  return rows.length;
}
