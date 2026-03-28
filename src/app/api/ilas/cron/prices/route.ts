// ILAS daily price ingestion cron
// Schedule: 0 12 * * 1-5 (weekdays noon UTC, after MPF at 11)
//
// NOTE: AIA's ILAS page loads fund data via AJAX (not server-rendered).
// This route accepts prices POSTed by a local Playwright script,
// or via GET triggers a fallback that checks for recently-posted prices.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { upsertIlasPrices } from "@/lib/ilas/scrapers/aia-ilas-scraper";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST: receive scraped prices from external script (Playwright or manual)
export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const start = Date.now();
  let body: { prices?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const prices = body.prices;

  if (!Array.isArray(prices) || prices.length === 0) {
    return NextResponse.json({ ok: false, error: "No prices provided" }, { status: 400 });
  }

  const { inserted, errors } = await upsertIlasPrices(prices);

  // Log scraper run
  const supabase = createAdminClient();
  await supabase.from("scraper_runs").insert({
    scraper_name: "ilas_prices",
    status: errors === 0 ? "success" : "partial",
    records_processed: inserted,
    error_message: errors > 0 ? `${errors} upsert errors` : null,
  });

  return NextResponse.json({
    ok: errors === 0,
    inserted,
    errors,
    total_received: prices.length,
    ms: Date.now() - start,
  });
}

// GET: cron trigger — checks if prices were posted today
export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const today = new Date().toISOString().split("T")[0];

  // Check if we have prices for today
  const { count } = await supabase
    .from("ilas_prices")
    .select("*", { count: "exact", head: true })
    .eq("date", today);

  if ((count || 0) > 0) {
    return NextResponse.json({
      ok: true,
      message: `${count} prices already loaded for ${today}`,
    });
  }

  return NextResponse.json({
    ok: false,
    message: `No prices for ${today}. Run the Playwright scraper script locally or POST prices to this endpoint.`,
  });
}
