// src/app/api/mpf/cron/prices/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { scrapeAAStocksPrices, upsertPrices } from "@/lib/mpf/scrapers/fund-prices";
import { PRICE_OUTLIER_THRESHOLD_PCT } from "@/lib/mpf/constants";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  // Verify cron secret
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const startTime = Date.now();

  // Log scraper run start
  const { data: run } = await supabase
    .from("scraper_runs")
    .insert({ scraper_name: "fund_prices", status: "running" })
    .select()
    .single();

  try {
    const prices = await scrapeAAStocksPrices();
    const count = await upsertPrices(prices);

    // Update scraper run
    await supabase
      .from("scraper_runs")
      .update({
        status: "success",
        records_processed: count,
        duration_ms: Date.now() - startTime,
      })
      .eq("id", run?.id);

    // Check for outliers in just-upserted prices
    const today = new Date().toISOString().split("T")[0];
    const { data: todayPrices } = await supabase
      .from("mpf_prices")
      .select("fund_id, daily_change_pct")
      .eq("date", today)
      .not("daily_change_pct", "is", null);

    const outlierFunds = todayPrices?.filter(
      (p) => Math.abs(p.daily_change_pct || 0) >= PRICE_OUTLIER_THRESHOLD_PCT
    );

    // If outliers found, trigger alert insight (async — don't wait)
    if (outlierFunds && outlierFunds.length > 0) {
      const fundIds = outlierFunds.map((f) => f.fund_id);
      await supabase.from("mpf_insights").insert({
        type: "alert",
        trigger: `price_outlier: ${outlierFunds.length} fund(s) moved >${PRICE_OUTLIER_THRESHOLD_PCT}%`,
        fund_ids: fundIds,
        status: "pending",
      });
    }

    return NextResponse.json({ ok: true, count, outliers: outlierFunds?.length || 0 });
  } catch (error) {
    await supabase
      .from("scraper_runs")
      .update({
        status: "failed",
        error_message: error instanceof Error ? error.message : "Unknown error",
        duration_ms: Date.now() - startTime,
      })
      .eq("id", run?.id);

    return NextResponse.json({ error: "Scrape failed" }, { status: 500 });
  }
}
