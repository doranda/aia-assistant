// ILAS metrics computation cron
// Schedule: 30 12 * * 1-5 (weekdays 12:30 UTC, 30 min after ILAS prices)

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeIlasMetrics } from "@/lib/ilas/metrics";
import type { MetricPeriod } from "@/lib/ilas/types";
import { sendDiscordAlert, sanitizeError, COLORS } from "@/lib/discord";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PERIODS: MetricPeriod[] = ["1y", "3y", "5y", "since_launch"];

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
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

    let upserted = 0;
    let skipped = 0;
    let errors = 0;

    // TODO: Known N+1 query pattern — each fund triggers a separate prices query (~710 queries at full scale).
    // Optimization: batch-fetch all prices in one query grouped by fund_id, then compute in-memory.
    for (const fund of funds) {
      // Get all prices for this fund
      const { data: prices, error: pricesErr } = await supabase
        .from("ilas_prices")
        .select("date, nav")
        .eq("fund_id", fund.id)
        .order("date", { ascending: true });

      if (pricesErr) {
        console.error(`[ilas-metrics] Failed to fetch prices for ${fund.fund_code}:`, pricesErr.message);
        errors++;
        continue;
      }

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

        const { error } = await supabase
          .from("ilas_fund_metrics")
          .upsert(
            {
              fund_id: fund.id,
              fund_code: fund.fund_code,
              period,
              ...metrics,
              computed_at: new Date().toISOString(),
            },
            { onConflict: "fund_id,period" }
          );

        if (error) {
          console.error(`[ilas-metrics] ${fund.fund_code}/${period}:`, error.message);
          errors++;
        } else {
          upserted++;
        }
      }
    }

    // Log scraper run
    const { error: logErr } = await supabase.from("scraper_runs").insert({
      scraper_name: "ilas_metrics",
      status: errors === 0 ? "success" : "partial",
      records_processed: upserted,
      error_message: errors > 0 ? `${errors} upsert errors` : null,
    });
    if (logErr) console.error("[ilas-metrics] Failed to log scraper run:", logErr.message);

    return NextResponse.json({
      ok: errors === 0,
      funds: funds.length,
      upserted,
      skipped,
      errors,
      ms: Date.now() - start,
    });
  } catch (error) {
    const supabase = createAdminClient();
    const { error: failLogErr } = await supabase.from("scraper_runs").insert({
      scraper_name: "ilas_metrics",
      status: "failed",
      error_message: error instanceof Error ? error.message : "Unknown error",
    });
    if (failLogErr) console.error("[cron/ilas-metrics] Failed to log error run:", failLogErr);
    await sendDiscordAlert({
      title: "❌ ILAS Track — Metrics Computation Failed",
      description: `**Error:** ${sanitizeError(error)}`,
      color: COLORS.red,
    });
    return NextResponse.json({ error: "Metrics computation failed" }, { status: 500 });
  }
}
