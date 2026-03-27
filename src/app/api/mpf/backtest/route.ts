import { NextRequest, NextResponse } from "next/server";
import { runBacktestSession, initBacktestRuns } from "@/lib/mpf/backtester";

export const maxDuration = 120;

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
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
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Unknown",
      ms: Date.now() - startTime,
    }, { status: 500 });
  }
}
