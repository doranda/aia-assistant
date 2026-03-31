// src/app/api/ilas/backfill/route.ts
// One-time backfill: generates ~2 weeks of synthetic ILAS prices
// by walking backwards from the current NAV using small random daily changes
// derived from each fund's risk profile and recent dd_change.
// This gives the metrics engine enough data points to compute initial metrics.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const AIA_FUND_INFO_URL =
  "https://www1.aia.com.hk/CorpWS/Investment/Get/FundInfo2/";

/** Parse AIA's HTML-formatted price into a number */
function parsePrice(raw: unknown): number | null {
  if (!raw) return null;
  const str = String(raw).replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/[▼▲]/g, "").trim();
  const match = str.match(/(US\$|HK\$|RMB|EUR€?|GBP|JPY|AUD|CAD|SGD|NZD)\[?([\d.]+)\]?/);
  if (!match) return null;
  const price = parseFloat(match[2]);
  return isNaN(price) || price <= 0 ? null : price;
}

/** Parse AIA date format "[MM/DD/YYYY]" → "YYYY-MM-DD" */
function parseDate(raw: unknown): string | null {
  if (!raw) return null;
  const clean = String(raw).replace(/[\[\]]/g, "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
  const m = clean.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
}

/** Get business days going backwards from a date */
function getBusinessDays(fromDate: string, count: number): string[] {
  const days: string[] = [];
  const d = new Date(fromDate + "T00:00:00");
  d.setDate(d.getDate() - 1); // start from the day before
  while (days.length < count) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) {
      days.push(d.toISOString().split("T")[0]);
    }
    d.setDate(d.getDate() - 1);
  }
  return days; // most recent first
}

/** Volatility scale by risk level */
function dailyVolatility(risk: string): number {
  switch (risk?.toLowerCase()) {
    case "low": return 0.001;    // 0.1% daily
    case "medium": return 0.004; // 0.4% daily
    case "high": return 0.008;   // 0.8% daily
    default: return 0.004;
  }
}

/** Seeded pseudo-random for reproducibility (simple LCG) */
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0x7fffffff;
    return (s / 0x7fffffff) * 2 - 1; // -1 to 1
  };
}

export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createAdminClient();

    // 1. Fetch current prices from AIA API
    const res = await fetch(
      `${AIA_FUND_INFO_URL}?fund_cat=TMP2&fund_type=&fund_house=&fund_code=&name=&lang=en`,
      {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; AIA-Hub/1.0)", Accept: "application/json" },
        signal: AbortSignal.timeout(15000),
      }
    );
    if (!res.ok) {
      return NextResponse.json({ error: `AIA API returned ${res.status}` }, { status: 502 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items: any[] = Array.isArray(data) ? data : data?.fundList ?? data?.data ?? [];

    if (items.length === 0) {
      return NextResponse.json({ error: "AIA API returned no funds" }, { status: 502 });
    }

    // 2. Get fund mapping from DB
    const { data: funds } = await supabase
      .from("ilas_funds")
      .select("id, fund_code, risk_rating");
    const fundMap = new Map((funds || []).map(f => [f.fund_code, f]));

    // 3. Check existing price dates to avoid duplicate backfill
    const { data: existingDateRows } = await supabase
      .from("ilas_prices")
      .select("date")
      .order("date", { ascending: true });
    const existingDateSet = new Set((existingDateRows || []).map(r => r.date));

    // 4. Generate synthetic historical prices
    const BACKFILL_DAYS = 10; // ~2 weeks of business days
    let totalInserted = 0;
    let totalSkipped = 0;
    const errors: string[] = [];

    for (const item of items) {
      const code: string = item.code ?? "";
      const fund = fundMap.get(code);
      if (!fund) continue;

      const currentNav = parsePrice(item.bidPrice ?? item.offerPrice);
      const valDate = parseDate(item.valuationDate);
      if (!currentNav || !valDate) continue;

      const risk = fund.risk_rating || "Medium";
      const vol = dailyVolatility(risk);

      // Use dd_change as a drift hint
      const ddChange = parseFloat(String(item.dd_change ?? "0")) || 0;
      const dailyDrift = ddChange / 100 / 5; // spread recent trend over ~5 days

      // Generate business days before the valuation date
      const backfillDates = getBusinessDays(valDate, BACKFILL_DAYS);

      // Filter out dates we already have prices for
      const datesToFill = backfillDates.filter(d => !existingDateSet.has(d));

      if (datesToFill.length === 0) {
        totalSkipped++;
        continue;
      }

      // Walk backwards from current NAV
      const rand = seededRandom(code.charCodeAt(0) * 1000 + code.charCodeAt(1));
      let nav = currentNav;
      const rows: { fund_id: string; date: string; nav: number; daily_change_pct: number | null; source: string }[] = [];

      // backfillDates is most-recent-first, so we walk backwards correctly
      for (const date of datesToFill) {
        const change = dailyDrift + vol * rand();
        nav = nav / (1 + change); // reverse the change to get previous day's price
        rows.push({
          fund_id: fund.id,
          date,
          nav: parseFloat(nav.toFixed(4)),
          daily_change_pct: parseFloat((change * 100).toFixed(4)),
          source: "backfill_synthetic",
        });
      }

      // Upsert in chunks
      const CHUNK = 50;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { error } = await supabase
          .from("ilas_prices")
          .upsert(rows.slice(i, i + CHUNK), { onConflict: "fund_id,date" });
        if (error) {
          errors.push(`${code}: ${error.message}`);
        } else {
          totalInserted += rows.slice(i, i + CHUNK).length;
        }
      }
    }

    // 5. Log the run
    const { error: logError } = await supabase.from("scraper_runs").insert({
      scraper_name: "ilas_backfill",
      status: errors.length === 0 ? "success" : "partial",
      records_processed: totalInserted,
      error_message: errors.length > 0 ? errors.slice(0, 5).join("; ") : null,
    });
    if (logError) console.error("[ilas/backfill] scraper_runs log failed:", logError);

    return NextResponse.json({
      ok: true,
      inserted: totalInserted,
      skipped: totalSkipped,
      errors: errors.length,
      backfill_days: BACKFILL_DAYS,
      note: "Synthetic prices generated from current NAV + risk-scaled volatility. Source marked as 'backfill_synthetic'.",
    });
  } catch (err) {
    console.error("[ilas-backfill] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
