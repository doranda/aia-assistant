// src/app/api/mpf/cron/prices/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { scrapeAAStocksPrices, upsertPrices } from "@/lib/mpf/scrapers/fund-prices";
import { scrapeAIAPerformance, upsertFundReturns, scrapeAIADailyPrices, upsertDailyPrices } from "@/lib/mpf/scrapers/aia-api";
// Yahoo Finance scraper removed from live cron — only used for backtesting historical data
// 5 Fidelity/HK/Japan funds were discontinued by AIA in June 2023
import { PRICE_OUTLIER_THRESHOLD_PCT } from "@/lib/mpf/constants";
import { processPendingAlerts } from "@/lib/mpf/alerts";
import { sendDiscordAlert, sanitizeError, COLORS } from "@/lib/discord";
import { getConsecutiveFailures } from "@/lib/mpf/health";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  // Verify cron secret
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const startTime = Date.now();

  // Log scraper run start
  const { data: run, error: runError } = await supabase
    .from("scraper_runs")
    .insert({ scraper_name: "fund_prices", status: "running" })
    .select()
    .single();

  if (runError) console.error("[prices-cron] scraper_runs insert failed:", runError);

  let source = "unknown";
  let count = 0;

  try {
    // STEP 1: Daily NAV prices from AIA getFundPriceList (T+2 business day lag)
    let dailySuccess = false;
    let isNewData = false;
    try {
      const dailyData = await scrapeAIADailyPrices();

      // Check if this is actually new data vs same date we already have
      const { data: latestRow, error: latestErr } = await supabase
        .from("mpf_prices")
        .select("date")
        .order("date", { ascending: false })
        .limit(1)
        .single();
      if (latestErr) console.error("[prices-cron] latest date check:", latestErr);

      const latestDateInDb = latestRow?.date ?? "";
      isNewData = dailyData.priceDate > latestDateInDb;

      const dailyCount = await upsertDailyPrices(dailyData);
      source = "aia_daily";
      count = dailyCount;
      dailySuccess = true;
      console.log(`[prices-cron] AIA daily prices: ${dailyCount} funds upserted (date: ${dailyData.priceDate}, new: ${isNewData}, prev: ${latestDateInDb})`);

      if (!isNewData && latestDateInDb) {
        await sendDiscordAlert({
          title: "ℹ️ MPF Care — No New Price Data",
          description: `AIA API still returning ${dailyData.priceDate} (same as DB). AIA publication lag — prices typically arrive ~2 business days late.`,
          color: COLORS.yellow,
        });
      }
    } catch (dailyErr) {
      console.error("[prices-cron] AIA daily prices failed:", dailyErr);
    }

    // STEP 2: Monthly performance returns from AIA getFundPerformance (always run)
    try {
      const aiaData = await scrapeAIAPerformance();
      const returnsCount = await upsertFundReturns(aiaData);
      console.log(`[prices-cron] AIA returns: ${returnsCount} funds upserted (as-at: ${aiaData.asAtDate})`);
      if (!dailySuccess) {
        source = "aia_api";
        count = returnsCount;
      }
    } catch (aiaErr) {
      console.error("[prices-cron] AIA performance API failed:", aiaErr);
    }

    // STEP 3 (FALLBACK): MPFA Excel — only if daily prices failed
    if (!dailySuccess) {
      try {
        const prices = await scrapeAAStocksPrices();
        const mpfaCount = await upsertPrices(prices);
        if (count === 0) {
          source = "mpfa";
          count = mpfaCount;
        }
        console.log(`[prices-cron] MPFA fallback: ${mpfaCount} records upserted`);
      } catch (mpfaErr) {
        console.error("[prices-cron] MPFA fallback also failed:", mpfaErr);
      }
    }

    // STEP 4 removed — 5 Fidelity/HK/Japan funds discontinued by AIA June 2023
    // Yahoo Finance scraper kept in codebase for backtesting only

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
      const { error: insightErr } = await supabase.from("mpf_insights").insert({
        type: "alert",
        trigger: `price_outlier: ${outlierFunds.length} fund(s) moved >${PRICE_OUTLIER_THRESHOLD_PCT}%`,
        fund_ids: fundIds,
        status: "pending",
      });
      if (insightErr) console.error("[cron/prices] Failed to insert price outlier insight:", insightErr);
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
