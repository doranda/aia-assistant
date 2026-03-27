import { NextRequest, NextResponse } from "next/server";
import { fetchYahooFinancePrices } from "@/lib/mpf/scrapers/yahoo-finance";

export const maxDuration = 120;

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();
  try {
    const count = await fetchYahooFinancePrices();
    return NextResponse.json({ ok: true, inserted: count, ms: Date.now() - startTime });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Unknown",
      ms: Date.now() - startTime,
    }, { status: 500 });
  }
}
