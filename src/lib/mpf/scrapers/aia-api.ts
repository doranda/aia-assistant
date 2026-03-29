// src/lib/mpf/scrapers/aia-api.ts
// Fetches fund performance from AIA's JSON API.
// Returns structured data with multi-period returns.

import { createAdminClient } from "@/lib/supabase/admin";
import { AIA_API_CODE_MAP } from "@/lib/mpf/constants";

const AIA_PERFORMANCE_URL =
  "https://www3.aia-pt.com.hk/common_ws/aiapt/FundPrice/getFundPerformance/MPF/";

// Daily NAV prices endpoint — updates T+2 business days
const AIA_PRICE_LIST_URL =
  "https://www3.aia-pt.com.hk/common_ws/aiapt/FundPrice/getFundPriceList/mpf";

export interface AIAFundPerformance {
  fund_code: string;      // Our internal code (AIA-AEF etc)
  aia_fund_code: string;  // AIA's code (L3 etc)
  name_en: string;
  name_zh: string;
  as_at_date: string;     // YYYY-MM-DD
  returns: {
    "1m": number | null;
    "3m": number | null;
    "1y": number | null;
    "3y": number | null;
    "5y": number | null;
    "10y": number | null;
    "ytd": number | null;
    "since_launch": number | null;
  };
  calendar_year_returns: Record<string, number | null>;
}

/**
 * Parse a percentage string like "7.56%" or "-3.21%" into a number.
 * Returns null for empty strings, "-", "N/A", null, or undefined.
 */
function parsePct(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  if (str === "" || str === "-" || str === "N/A" || str === "n/a") return null;
  const cleaned = str.replace("%", "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/**
 * Parse AIA date string. The API returns dates like "28/02/2025" or "2025-02-28".
 * Normalises to YYYY-MM-DD.
 */
function parseDate(value: unknown): string {
  if (!value) return "";
  const str = String(value).trim();

  // DD/MM/YYYY
  const slashMatch = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (slashMatch) {
    return `${slashMatch[3]}-${slashMatch[2]}-${slashMatch[1]}`;
  }

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  return str;
}

/**
 * Fetch fund performance from AIA's public JSON API.
 * Returns asAtDate (YYYY-MM-DD) and array of AIAFundPerformance.
 */
export async function scrapeAIAPerformance(): Promise<{
  asAtDate: string;
  funds: AIAFundPerformance[];
}> {
  const res = await fetch(AIA_PERFORMANCE_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; AIA-Hub/1.0)",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    throw new Error(`AIA API returned ${res.status}: ${res.statusText}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: any = await res.json();

  // AIA API response shape: { asAtDate, perf1YrendDate, ..., performanceDetails: [...] }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items: any[] = raw?.performanceDetails ?? raw?.data ?? raw?.fundList ?? raw?.funds ?? (Array.isArray(raw) ? raw : []);

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error(`AIA API returned unexpected shape — no fund array found. Keys: ${Object.keys(raw).join(", ")}`);
  }

  const funds: AIAFundPerformance[] = [];
  // asAtDate from top-level (format: "20260227" → "2026-02-27")
  let asAtDate = "";
  const topDate = String(raw?.asAtDate ?? "");
  if (/^\d{8}$/.test(topDate)) {
    asAtDate = `${topDate.slice(0, 4)}-${topDate.slice(4, 6)}-${topDate.slice(6, 8)}`;
  }

  // Calendar year date fields from top-level
  const calYearDates: Record<string, string> = {};
  for (let i = 1; i <= 5; i++) {
    const key = `perf${i}YrendDate`;
    const val = String(raw?.[key] ?? "").trim();
    if (val) calYearDates[String(i)] = val;
  }

  for (const item of items) {
    const aiaCode: string = item.fundCode ?? item.fund_code ?? "";

    const internalCode = AIA_API_CODE_MAP[aiaCode];
    if (!internalCode) continue;

    // Returns — exact field names from the AIA API
    const returns: AIAFundPerformance["returns"] = {
      "1m":           parsePct(item.performance1M),
      "3m":           parsePct(item.performance3M),
      "1y":           parsePct(item.performance1Y),
      "3y":           parsePct(item.performance3Y),
      "5y":           parsePct(item.performance5Y),
      "10y":          parsePct(item.performance10Y),
      "ytd":          parsePct(item.performanceYTD),
      "since_launch": parsePct(item.performanceLaunch),
    };

    // Calendar year returns: performance1Yrend through performance5Yrend
    const calendar_year_returns: Record<string, number | null> = {};
    for (let i = 1; i <= 5; i++) {
      const val = parsePct(item[`performance${i}Yrend`]);
      const year = calYearDates[String(i)];
      if (year && val !== null) {
        calendar_year_returns[year] = val;
      }
    }

    funds.push({
      fund_code: internalCode,
      aia_fund_code: aiaCode,
      name_en: String(item.constituentFund ?? ""),
      name_zh: String(item.constituentFundChi ?? ""),
      as_at_date: asAtDate,
      returns,
      calendar_year_returns,
    });
  }

  console.log(
    `[AIA-API] Parsed ${funds.length} funds, as-at ${asAtDate}`
  );

  return { asAtDate, funds };
}

export interface AIADailyPrice {
  fund_code: string;      // Our internal code (AIA-AEF etc)
  aia_fund_code: string;  // AIA's code (L3 etc)
  date: string;           // YYYY-MM-DD
  nav: number;
}

/**
 * Fetch current NAV prices from AIA's daily price list endpoint.
 * Returns ~T+2 business day data for all 20 funds in a single call.
 */
export async function scrapeAIADailyPrices(): Promise<{
  priceDate: string;
  prices: AIADailyPrice[];
}> {
  const res = await fetch(AIA_PRICE_LIST_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; AIA-Hub/1.0)",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    throw new Error(`AIA Price List API returned ${res.status}: ${res.statusText}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items: any[] = await res.json();

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("AIA Price List API returned empty array");
  }

  const prices: AIADailyPrice[] = [];
  let priceDate = "";

  for (const item of items) {
    const aiaCode: string = item.fundCode ?? "";
    const internalCode = AIA_API_CODE_MAP[aiaCode];
    if (!internalCode) continue;

    const nav = parseFloat(item.unitPrice ?? item.price ?? "0");
    if (isNaN(nav) || nav <= 0) continue;

    // valutationDate format: "20260320" → "2026-03-20"
    const dateRaw = String(item.valutationDate ?? item.valuationDate ?? "");
    if (/^\d{8}$/.test(dateRaw)) {
      const d = `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`;
      if (!priceDate || d > priceDate) priceDate = d;
      prices.push({ fund_code: internalCode, aia_fund_code: aiaCode, date: d, nav });
    }
  }

  console.log(`[AIA-Daily] Parsed ${prices.length} fund prices, date: ${priceDate}`);
  return { priceDate, prices };
}

/**
 * Upsert daily NAV prices into mpf_prices.
 * Calculates daily_change_pct from the previous record.
 * Returns count of successfully upserted rows.
 */
export async function upsertDailyPrices(data: {
  priceDate: string;
  prices: AIADailyPrice[];
}): Promise<number> {
  if (data.prices.length === 0) return 0;

  const supabase = createAdminClient();

  const { data: fundsDb, error: fundErr } = await supabase
    .from("mpf_funds")
    .select("id, fund_code");

  if (fundErr) throw new Error(`Failed to fetch mpf_funds: ${fundErr.message}`);

  const fundMap = new Map((fundsDb ?? []).map((f) => [f.fund_code, f.id]));
  let upserted = 0;

  for (const price of data.prices) {
    const fund_id = fundMap.get(price.fund_code);
    if (!fund_id) continue;

    // Get previous price for daily_change_pct
    const { data: prev, error: prevError } = await supabase
      .from("mpf_prices")
      .select("nav")
      .eq("fund_id", fund_id)
      .lt("date", price.date)
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (prevError) console.error(`[aia-api] prev price query failed for fund ${fund_id}:`, prevError.message);

    const dailyChange = prev?.nav
      ? Math.round(((price.nav - prev.nav) / prev.nav) * 10000) / 100
      : 0;

    const { error } = await supabase.from("mpf_prices").upsert(
      {
        fund_id,
        date: price.date,
        nav: price.nav,
        daily_change_pct: dailyChange,
        source: "aia_api",
      },
      { onConflict: "fund_id,date" }
    );

    if (error) {
      console.error(`[AIA-Daily] upsert failed for ${price.fund_code}:`, error.message);
      continue;
    }
    upserted++;
  }

  return upserted;
}

/**
 * Upsert fund returns data into mpf_fund_returns.
 * Also upserts a synthetic NAV-equivalent price into mpf_prices using the 1M return
 * for backward compatibility with the existing dashboard.
 *
 * Returns count of successfully upserted rows.
 */
export async function upsertFundReturns(data: {
  asAtDate: string;
  funds: AIAFundPerformance[];
}): Promise<number> {
  if (data.funds.length === 0) return 0;

  const supabase = createAdminClient();

  // Get fund_id map
  const { data: fundsDb, error: fundErr } = await supabase
    .from("mpf_funds")
    .select("id, fund_code");

  if (fundErr) throw new Error(`Failed to fetch mpf_funds: ${fundErr.message}`);

  const fundMap = new Map((fundsDb ?? []).map((f) => [f.fund_code, f.id]));

  let upserted = 0;

  for (const fund of data.funds) {
    const fund_id = fundMap.get(fund.fund_code);
    if (!fund_id) continue;

    const as_at_date = fund.as_at_date || data.asAtDate;
    if (!as_at_date) continue;

    // Upsert into mpf_fund_returns
    const { error: retErr } = await supabase
      .from("mpf_fund_returns")
      .upsert(
        {
          fund_id,
          as_at_date,
          return_1m:           fund.returns["1m"],
          return_3m:           fund.returns["3m"],
          return_1y:           fund.returns["1y"],
          return_3y:           fund.returns["3y"],
          return_5y:           fund.returns["5y"],
          return_10y:          fund.returns["10y"],
          return_ytd:          fund.returns["ytd"],
          return_since_launch: fund.returns["since_launch"],
          calendar_year_returns: fund.calendar_year_returns,
          source: "aia_api",
        },
        { onConflict: "fund_id,as_at_date" }
      );

    if (retErr) {
      console.error(`[AIA-API] upsert fund_returns failed for ${fund.fund_code}:`, retErr.message);
      continue;
    }

    // Upsert synthetic price into mpf_prices for backward compat.
    // We don't have a raw NAV from the performance API, so we only update
    // if there's no existing price record for this fund/date (avoid overwriting
    // real NAV data).  We skip if return_1m is null since we can't derive a NAV.
    if (fund.returns["1m"] !== null) {
      // Get the most recent existing price to derive a pseudo-NAV
      const { data: latestPrice, error: latestPriceError } = await supabase
        .from("mpf_prices")
        .select("nav, date")
        .eq("fund_id", fund_id)
        .lt("date", as_at_date)
        .order("date", { ascending: false })
        .limit(1)
        .single();
      if (latestPriceError) console.error(`[aia-api] latest price query failed for fund ${fund_id}:`, latestPriceError.message);

      if (latestPrice?.nav) {
        const syntheticNav = Number(
          (latestPrice.nav * (1 + fund.returns["1m"] / 100)).toFixed(4)
        );
        // Only insert if no record already exists for this date
        const { data: existing, error: existingError } = await supabase
          .from("mpf_prices")
          .select("id")
          .eq("fund_id", fund_id)
          .eq("date", as_at_date)
          .maybeSingle();
        if (existingError) console.error(`[aia-api] existing price check failed for fund ${fund_id}:`, existingError.message);

        if (!existing) {
          const { error: priceUpsertError } = await supabase.from("mpf_prices").upsert(
            {
              fund_id,
              date: as_at_date,
              nav: syntheticNav,
              daily_change_pct: null,
              source: "aia_api",
            },
            { onConflict: "fund_id,date" }
          );
          if (priceUpsertError) console.error("[aia-api] price upsert failed:", priceUpsertError);
        }
      }
    }

    upserted++;
  }

  return upserted;
}
