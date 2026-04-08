import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  expireStaleIlasRequests,
  processIlasSettlements,
  computeAndStoreIlasNav,
} from "@/lib/ilas/portfolio-tracker";
import { isWorkingDay, loadHKHolidays } from "@/lib/mpf/portfolio-tracker";
import { sendDiscordAlert, COLORS } from "@/lib/discord";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
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

    // 1. Process accumulation portfolio
    const accExpired = await expireStaleIlasRequests("accumulation");
    const accSettled = await processIlasSettlements("accumulation");
    const accNav = await computeAndStoreIlasNav(today, "accumulation");

    // 2. Process distribution portfolio
    const disExpired = await expireStaleIlasRequests("distribution");
    const disSettled = await processIlasSettlements("distribution");
    const disNav = await computeAndStoreIlasNav(today, "distribution");

    // Log heartbeat
    const totalSettled = accSettled.settled + disSettled.settled;
    const navCount = (accNav.nav > 0 ? 1 : 0) + (disNav.nav > 0 ? 1 : 0);

    const { error: runLogErr } = await supabase.from("scraper_runs").insert({
      scraper_name: "ilas_portfolio_nav",
      status: "success",
      records_processed: totalSettled + navCount,
      duration_ms: Date.now() - t0,
    });
    if (runLogErr) console.error("[cron/ilas-portfolio-nav] Failed to log success run:", runLogErr);

    // Report blocked settlements
    const allBlocked = [...accSettled.blocked, ...disSettled.blocked];
    if (allBlocked.length > 0) {
      console.warn("[ilas-portfolio-nav] Blocked settlements:", allBlocked);
    }

    return NextResponse.json({
      ok: true,
      date: today,
      accumulation: {
        nav: Number(accNav.nav.toFixed(6)),
        isCash: accNav.isCash,
        settled: accSettled.settled,
        blocked: accSettled.blocked.length,
        expired: accExpired,
      },
      distribution: {
        nav: Number(disNav.nav.toFixed(6)),
        isCash: disNav.isCash,
        settled: disSettled.settled,
        blocked: disSettled.blocked.length,
        expired: disExpired,
      },
      ms: Date.now() - t0,
    });
  } catch (error) {
    console.error("[ilas-portfolio-nav] Cron failed:", error);

    const { error: failLogErr } = await supabase.from("scraper_runs").insert({
      scraper_name: "ilas_portfolio_nav",
      status: "failed",
      error_message: error instanceof Error ? error.message : "Unknown",
      duration_ms: Date.now() - t0,
    });
    if (failLogErr) console.error("[cron/ilas-portfolio-nav] Failed to log error run:", failLogErr);

    await sendDiscordAlert({
      title: "ILAS Portfolio NAV Cron Failed",
      description: `Error: ${error instanceof Error ? error.message : "Unknown"}\nDuration: ${Date.now() - t0}ms`,
      color: COLORS.red,
    }, { urgent: true });

    return NextResponse.json({ error: "ILAS portfolio NAV cron failed" }, { status: 500 });
  }
}
