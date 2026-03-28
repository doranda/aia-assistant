import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeAllMetrics } from "@/lib/mpf/metrics";
import { sendDiscordAlert, sanitizeError, COLORS } from "@/lib/discord";
import type { MetricPeriod } from "@/lib/mpf/types";

export const maxDuration = 60;

const PERIODS: MetricPeriod[] = ["1y", "3y", "5y", "since_launch"];

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const startTime = Date.now();
  let totalUpserted = 0;

  try {
    const { data: funds } = await supabase
      .from("mpf_funds")
      .select("id, fund_code")
      .eq("is_active", true);

    if (!funds?.length) {
      return NextResponse.json({ ok: true, count: 0, reason: "No active funds" });
    }

    for (const fund of funds) {
      const { data: prices } = await supabase
        .from("mpf_prices")
        .select("date, nav")
        .eq("fund_id", fund.id)
        .order("date", { ascending: true });

      if (!prices?.length) continue;

      for (const period of PERIODS) {
        const metrics = computeAllMetrics(prices, fund.fund_code, period);
        const hasData = Object.values(metrics).some(v => v !== null);
        if (!hasData) continue;

        const { error: upsertErr } = await supabase
          .from("mpf_fund_metrics")
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

        if (upsertErr) {
          console.error(`[metrics] upsert error for ${fund.fund_code}/${period}:`, upsertErr);
          continue;
        }

        totalUpserted++;
      }
    }

    await supabase.from("scraper_runs").insert({
      scraper_name: "fund_metrics",
      status: "success",
      records_processed: totalUpserted,
      duration_ms: Date.now() - startTime,
    });

    return NextResponse.json({
      ok: true,
      count: totalUpserted,
      funds: funds.length,
      ms: Date.now() - startTime,
    });
  } catch (error) {
    await supabase.from("scraper_runs").insert({
      scraper_name: "fund_metrics",
      status: "failed",
      error_message: error instanceof Error ? error.message : "Unknown error",
      duration_ms: Date.now() - startTime,
    });

    await sendDiscordAlert({
      title: "❌ MPF Care — Metrics Computation Failed",
      description: `**Error:** ${sanitizeError(error)}\n**Duration:** ${Date.now() - startTime}ms`,
      color: COLORS.red,
    });

    return NextResponse.json({ error: "Metrics computation failed" }, { status: 500 });
  }
}
