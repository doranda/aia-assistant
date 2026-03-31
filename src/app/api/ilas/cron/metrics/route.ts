// ILAS metrics computation cron
// Schedule: 30 12 * * 1-5 (weekdays 12:30 UTC, 30 min after ILAS prices)

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeIlasMetrics } from "@/lib/ilas/metrics";
import type { MetricPeriod } from "@/lib/ilas/types";
import { sendDiscordAlert, sanitizeError, COLORS } from "@/lib/discord";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const PERIODS: MetricPeriod[] = ["1y", "3y", "5y", "since_launch"];

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const start = Date.now();

  try {
    const supabase = createAdminClient();

    // Get all active ILAS funds
    const { data: funds, error: fundsError } = await supabase
      .from("ilas_funds")
      .select("id, fund_code")
      .eq("is_active", true);

    if (fundsError || !funds) {
      console.error("[ilas-metrics] Failed to fetch funds:", fundsError?.message);
      return NextResponse.json({ ok: false, error: fundsError?.message }, { status: 500 });
    }

    // Batch-fetch ALL prices in one query (fixes N+1 pattern)
    const { data: allPrices, error: pricesError } = await supabase
      .from("ilas_prices")
      .select("fund_id, date, nav")
      .order("date", { ascending: true });

    if (pricesError) {
      console.error("[ilas-metrics] Failed to batch-fetch prices:", pricesError.message);
      return NextResponse.json({ ok: false, error: pricesError.message }, { status: 500 });
    }

    // Group prices by fund_id in memory
    const pricesByFund = new Map<string, { date: string; nav: number }[]>();
    for (const p of allPrices || []) {
      if (!pricesByFund.has(p.fund_id)) pricesByFund.set(p.fund_id, []);
      pricesByFund.get(p.fund_id)!.push({ date: p.date, nav: p.nav });
    }

    let upserted = 0;
    let skipped = 0;
    let errors = 0;

    // Collect all upsert rows and batch at the end
    const upsertRows: {
      fund_id: string;
      fund_code: string;
      period: MetricPeriod;
      computed_at: string;
      [key: string]: unknown;
    }[] = [];

    for (const fund of funds) {
      const prices = pricesByFund.get(fund.id);

      if (!prices || prices.length < 3) {
        skipped++;
        continue;
      }

      for (const period of PERIODS) {
        const metrics = computeIlasMetrics(prices, period);

        // Skip if all metrics are null (not enough data for this period)
        if (
          metrics.sharpe_ratio === null &&
          metrics.annualized_return_pct === null
        ) {
          continue;
        }

        upsertRows.push({
          fund_id: fund.id,
          fund_code: fund.fund_code,
          period,
          ...metrics,
          computed_at: new Date().toISOString(),
        });
      }
    }

    // Batch upsert in chunks of 100
    const CHUNK = 100;
    for (let i = 0; i < upsertRows.length; i += CHUNK) {
      const chunk = upsertRows.slice(i, i + CHUNK);
      const { error } = await supabase
        .from("ilas_fund_metrics")
        .upsert(chunk, { onConflict: "fund_id,period" });

      if (error) {
        console.error(`[ilas-metrics] Batch upsert chunk ${i}:`, error.message);
        errors += chunk.length;
      } else {
        upserted += chunk.length;
      }
    }

    const ms = Date.now() - start;

    // Log scraper run
    const { error: logError } = await supabase.from("scraper_runs").insert({
      scraper_name: "ilas_metrics",
      status: errors === 0 ? "success" : "partial",
      records_processed: upserted,
      duration_ms: ms,
      error_message: errors > 0 ? `${errors} upsert errors` : null,
    });
    if (logError) console.error("[ilas/metrics] scraper_runs log failed:", logError);

    console.log(`[ilas-metrics] Done: ${upserted} upserted, ${skipped} skipped, ${errors} errors in ${ms}ms`);

    return NextResponse.json({
      ok: true,
      funds: funds.length,
      upserted,
      skipped,
      errors,
      ms,
    });
  } catch (err) {
    const msg = sanitizeError(err);
    console.error("[ilas-metrics] Unexpected error:", msg);

    await sendDiscordAlert({
      title: "❌ ILAS Metrics Cron Failed",
      description: msg,
      color: COLORS.red,
    }).catch(() => {});

    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
