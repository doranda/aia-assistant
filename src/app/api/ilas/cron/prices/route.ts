// ILAS daily price ingestion cron
// Schedule: 0 12 * * 1-5 (weekdays noon UTC, after MPF at 11)
//
// GET: cron trigger — scrapes AIA CorpWS API directly
// POST: manual fallback — accepts prices from external scripts

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  scrapeILASPrices,
  upsertIlasPrices,
} from "@/lib/ilas/scrapers/aia-ilas-scraper";
import { sendDiscordAlert, sanitizeError, COLORS } from "@/lib/discord";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET: cron trigger — scrape CorpWS API and upsert prices
export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const start = Date.now();

  try {
    // Scrape prices from AIA CorpWS API
    const { prices, errors: scrapeErrors } = await scrapeILASPrices();

    if (prices.length === 0) {
      // Log failed scraper run
      const supabase = createAdminClient();
      const { error: emptyLogErr } = await supabase.from("scraper_runs").insert({
        scraper_name: "ilas_prices",
        status: "error",
        records_processed: 0,
        error_message: scrapeErrors.join("; ") || "No prices scraped",
      });
      if (emptyLogErr) console.error("[cron/ilas-prices] Failed to log empty scrape run:", emptyLogErr);

      return NextResponse.json(
        {
          ok: false,
          error: "No prices scraped from CorpWS API",
          details: scrapeErrors,
          ms: Date.now() - start,
        },
        { status: 502 }
      );
    }

    // Upsert into DB
    const { inserted, errors: upsertErrorCount } =
      await upsertIlasPrices(prices);

    const allErrors = [...scrapeErrors];
    if (upsertErrorCount > 0) {
      allErrors.push(`${upsertErrorCount} upsert errors`);
    }

    // Log scraper run
    const supabase = createAdminClient();
    const { error: successLogErr } = await supabase.from("scraper_runs").insert({
      scraper_name: "ilas_prices",
      status: allErrors.length === 0 ? "success" : "partial",
      records_processed: inserted,
      error_message: allErrors.length > 0 ? allErrors.join("; ") : null,
    });
    if (successLogErr) console.error("[cron/ilas-prices] Failed to log success run:", successLogErr);

    return NextResponse.json({
      ok: allErrors.length === 0,
      scraped: prices.length,
      inserted,
      errors: allErrors,
      ms: Date.now() - start,
    });
  } catch (error) {
    const supabase = createAdminClient();
    const { error: failLogErr } = await supabase.from("scraper_runs").insert({
      scraper_name: "ilas_prices",
      status: "failed",
      error_message: error instanceof Error ? error.message : "Unknown error",
    });
    if (failLogErr) console.error("[cron/ilas-prices] Failed to log GET error run:", failLogErr);
    await sendDiscordAlert({
      title: "❌ ILAS Track — Price Scrape Failed",
      description: `**Error:** ${sanitizeError(error)}`,
      color: COLORS.red,
    });
    return NextResponse.json({ error: "Scrape failed" }, { status: 500 });
  }
}

// POST: receive scraped prices from external script (manual fallback)
export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const start = Date.now();

  try {
    let body: { prices?: unknown };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { ok: false, error: "Invalid JSON body" },
        { status: 400 }
      );
    }
    const prices = body.prices;

    if (!Array.isArray(prices) || prices.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No prices provided" },
        { status: 400 }
      );
    }

    const { inserted, errors } = await upsertIlasPrices(prices);

    // Log scraper run
    const supabase = createAdminClient();
    const { error: postLogErr } = await supabase.from("scraper_runs").insert({
      scraper_name: "ilas_prices",
      status: errors === 0 ? "success" : "partial",
      records_processed: inserted,
      error_message: errors > 0 ? `${errors} upsert errors` : null,
    });
    if (postLogErr) console.error("[cron/ilas-prices] Failed to log POST success run:", postLogErr);

    return NextResponse.json({
      ok: errors === 0,
      inserted,
      errors,
      total_received: prices.length,
      ms: Date.now() - start,
    });
  } catch (error) {
    const supabase = createAdminClient();
    const { error: postFailLogErr } = await supabase.from("scraper_runs").insert({
      scraper_name: "ilas_prices",
      status: "failed",
      error_message: error instanceof Error ? error.message : "Unknown error",
    });
    if (postFailLogErr) console.error("[cron/ilas-prices] Failed to log POST error run:", postFailLogErr);
    await sendDiscordAlert({
      title: "❌ ILAS Track — Price POST Failed",
      description: `**Error:** ${sanitizeError(error)}`,
      color: COLORS.red,
    });
    return NextResponse.json({ error: "POST failed" }, { status: 500 });
  }
}
