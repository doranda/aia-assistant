// src/app/api/mpf/cron/prices/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { scrapeAAStocksPrices, upsertPrices } from "@/lib/mpf/scrapers/fund-prices";
import { scrapeAIAPerformance, upsertFundReturns } from "@/lib/mpf/scrapers/aia-api";
import { PRICE_OUTLIER_THRESHOLD_PCT } from "@/lib/mpf/constants";
import { processPendingAlerts } from "@/lib/mpf/alerts";
import { sendDiscordAlert, sanitizeError, COLORS } from "@/lib/discord";
import { getConsecutiveFailures } from "@/lib/mpf/health";

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

  let source = "unknown";
  let count = 0;

  try {
    // PRIMARY: AIA JSON API — richer data (multi-period returns + calendar years)
    let aiaSuccess = false;
    try {
      const aiaData = await scrapeAIAPerformance();
      count = await upsertFundReturns(aiaData);
      source = "aia_api";
      aiaSuccess = true;
      console.log(`[prices-cron] AIA API succeeded: ${count} funds upserted`);

      // Stale source detection
      const now = new Date();
      const hkTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Hong_Kong" }));
      if (hkTime.getHours() >= 19) {
        const today = hkTime.toISOString().split("T")[0];
        if (aiaData.asAtDate && aiaData.asAtDate < today) {
          await sendDiscordAlert({
            title: "\u26a0\ufe0f MPF Care \u2014 Stale Price Data",
            description: `AIA API returned data from ${aiaData.asAtDate} (expected ${today})`,
            color: COLORS.yellow,
          });
        }
      }
    } catch (aiaErr) {
      console.error("[prices-cron] AIA API failed, falling back to MPFA Excel:", aiaErr);
    }

    // FALLBACK: MPFA Excel — used only if AIA API failed
    if (!aiaSuccess) {
      const prices = await scrapeAAStocksPrices();
      count = await upsertPrices(prices);
      source = "mpfa";
      console.log(`[prices-cron] MPFA fallback succeeded: ${count} records upserted`);
    }

    // Update scraper run
    await supabase
      .from("scraper_runs")
      .update({
        status: "success",
        records_processed: count,
        duration_ms: Date.now() - startTime,
        // Store which source was used in error_message field (re-purposed for metadata)
        error_message: `source:${source}`,
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

    await processPendingAlerts();
    return NextResponse.json({ ok: true, count, source, outliers: outlierFunds?.length || 0 });
  } catch (error) {
    await supabase
      .from("scraper_runs")
      .update({
        status: "failed",
        error_message: error instanceof Error ? error.message : "Unknown error",
        duration_ms: Date.now() - startTime,
      })
      .eq("id", run?.id);

    // Discord failure alert
    const failures = await getConsecutiveFailures(supabase, "fund_prices");
    const isEscalated = failures >= 2;
    await sendDiscordAlert({
      title: `${isEscalated ? "\ud83d\udd34" : "\u274c"} MPF Care \u2014 Price Update Failed`,
      description: [
        `**Error:** ${sanitizeError(error)}`,
        `**Consecutive failures:** ${failures}`,
        `**Duration:** ${Date.now() - startTime}ms`,
      ].join("\n"),
      color: COLORS.red,
    });

    return NextResponse.json({ error: "Scrape failed" }, { status: 500 });
  }
}
