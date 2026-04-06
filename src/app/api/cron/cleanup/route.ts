// Daily cleanup cron — runs EVERY day including weekends and holidays.
// Handles housekeeping that the portfolio-nav crons skip on non-working days:
//   1. Expire stale emergency switch requests (MPF + ILAS)
//   2. Fix scraper runs stuck in "running" for >1 hour
//
// Schedule: 0 5 * * * (05:00 UTC daily, after portfolio-nav crons)

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { expireStaleRequests } from "@/lib/mpf/portfolio-tracker";
import { expireStaleIlasRequests } from "@/lib/ilas/portfolio-tracker";
import { sendDiscordAlert, COLORS } from "@/lib/discord";

export const maxDuration = 30;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Record<string, unknown> = {};

  // 1. Expire stale emergency switches (MPF + ILAS)
  try {
    const mpfExpired = await expireStaleRequests();
    const ilasAccExpired = await expireStaleIlasRequests("accumulation");
    const ilasDisExpired = await expireStaleIlasRequests("distribution");
    results.expired_switches = {
      mpf: mpfExpired,
      ilas_accumulation: ilasAccExpired,
      ilas_distribution: ilasDisExpired,
    };
  } catch (err) {
    console.error("[cleanup] expire switches failed:", err);
    results.expired_switches = { error: err instanceof Error ? err.message : "Unknown" };
  }

  // 2. Fix scraper runs stuck in "running" for >1 hour
  try {
    const supabase = createAdminClient();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const { data: stuck, error: stuckErr } = await supabase
      .from("scraper_runs")
      .update({
        status: "failed",
        error_message: "Timed out — stuck in running for >1h. Auto-cleaned by cleanup cron.",
      })
      .eq("status", "running")
      .lt("created_at", oneHourAgo)
      .select("id, scraper_name, created_at");

    if (stuckErr) console.error("[cleanup] stuck runs fix failed:", stuckErr);

    const stuckCount = stuck?.length || 0;
    results.stuck_runs_fixed = stuckCount;

    if (stuckCount > 0) {
      const names = stuck!.map((r) => r.scraper_name).join(", ");
      await sendDiscordAlert({
        title: "🧹 Cleanup — Fixed Stuck Scraper Runs",
        description: `${stuckCount} run(s) stuck in "running" for >1h: ${names}`,
        color: COLORS.yellow,
      });
    }
  } catch (err) {
    console.error("[cleanup] stuck runs check failed:", err);
    results.stuck_runs_fixed = { error: err instanceof Error ? err.message : "Unknown" };
  }

  return NextResponse.json({ ok: true, ...results });
}
