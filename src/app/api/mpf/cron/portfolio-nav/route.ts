import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  processSettlements,
  computeAndStoreNav,
  expireStaleRequests,
  isWorkingDay,
  loadHKHolidays,
} from "@/lib/mpf/portfolio-tracker";
import { sendDiscordAlert, COLORS } from "@/lib/discord";

export const maxDuration = 120;

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const t0 = Date.now();
  const supabase = createAdminClient();
  const today = new Date().toISOString().split("T")[0];

  try {
    // Skip non-working days
    const holidays = await loadHKHolidays();
    if (!isWorkingDay(today, holidays)) {
      return NextResponse.json({ ok: true, skipped: true, reason: "Non-working day" });
    }

    // Step 1: Expire stale emergency requests (>48h)
    const expired = await expireStaleRequests();

    // Step 2: Process settlements (atomic via Postgres function)
    const { settled, blocked } = await processSettlements();

    // Step 3: Compute and store today's portfolio NAV
    const { nav, isCash } = await computeAndStoreNav(today);

    // Step 4: Monthly switch count warning
    const monthStart = today.slice(0, 7) + "-01";
    const { data: monthSwitches, error: switchErr } = await supabase
      .from("mpf_pending_switches")
      .select("id")
      .in("status", ["pending", "settled"])
      .gte("created_at", monthStart);
    if (switchErr) console.error("[portfolio-nav] monthSwitches query failed:", switchErr);
    const monthCount = monthSwitches?.length || 0;

    if (monthCount > 2) {
      await sendDiscordAlert({
        title: "⚠️ MPF Care — High Switch Frequency",
        description: `${monthCount} switches this month. Cash drag is accumulating.`,
        color: COLORS.yellow,
      });
    }

    // Step 5: Log heartbeat
    const { error: runLogErr } = await supabase.from("scraper_runs").insert({
      scraper_name: "portfolio_nav",
      status: "success",
      records_processed: settled + (nav > 0 ? 1 : 0),
      duration_ms: Date.now() - t0,
    });
    if (runLogErr) console.error("[cron/portfolio-nav] Failed to log success run:", runLogErr);

    // Step 6: Report blocked settlements
    if (blocked.length > 0) {
      console.warn("[portfolio-nav] Blocked settlements:", blocked);
    }

    return NextResponse.json({
      ok: true,
      date: today,
      nav: Number(nav.toFixed(6)),
      isCash,
      settled,
      blocked: blocked.length,
      expired,
      monthSwitches: monthCount,
      ms: Date.now() - t0,
    });
  } catch (error) {
    console.error("[portfolio-nav] Cron failed:", error);

    const { error: failLogErr } = await supabase.from("scraper_runs").insert({
      scraper_name: "portfolio_nav",
      status: "failed",
      error_message: error instanceof Error ? error.message : "Unknown",
      duration_ms: Date.now() - t0,
    });
    if (failLogErr) console.error("[cron/portfolio-nav] Failed to log error run:", failLogErr);

    await sendDiscordAlert({
      title: "❌ MPF Care — Portfolio NAV Cron Failed",
      description: `Error: ${error instanceof Error ? error.message : "Unknown"}\nDuration: ${Date.now() - t0}ms`,
      color: COLORS.red,
    });

    return NextResponse.json({ error: "Portfolio NAV cron failed" }, { status: 500 });
  }
}
