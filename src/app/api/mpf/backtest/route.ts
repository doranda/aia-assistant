import { NextRequest, NextResponse } from "next/server";
import { runBacktestSession, initBacktestRuns } from "@/lib/mpf/backtester";

export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();

  try {
    // Initialize runs if first time (start from 2018-01-01)
    await initBacktestRuns("2018-01-01", "2025-12-31");

    // Run session with default budget
    const result = await runBacktestSession();

    return NextResponse.json({
      ok: true,
      ...result,
      ms: Date.now() - startTime,
    });
  } catch (error) {
    console.error("[mpf/backtest] error:", error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Unknown",
      ms: Date.now() - startTime,
    }, { status: 500 });
  }
}
