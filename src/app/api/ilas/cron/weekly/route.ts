// ILAS weekly rebalance debate — runs accumulation + distribution debates
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { evaluateAndRebalanceIlas } from "@/lib/ilas/rebalancer";
import { sendDiscordAlert, sanitizeError, COLORS } from "@/lib/discord";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const startTime = Date.now();

  try {
    // Check high-impact news (shared mpf_news table)
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const { data: highImpactNews } = await supabase
      .from("mpf_news")
      .select("id")
      .eq("is_high_impact", true)
      .gte("published_at", twoDaysAgo);

    const highImpactCount = highImpactNews?.length || 0;

    // Run accumulation debate
    const accResult = await evaluateAndRebalanceIlas("accumulation", highImpactCount);

    // Run distribution debate
    const disResult = await evaluateAndRebalanceIlas("distribution", highImpactCount);

    // Log scraper run
    await supabase.from("scraper_runs").insert({
      scraper_name: "ilas_weekly_debate",
      status: "success",
      records_processed: (accResult.rebalanced ? 1 : 0) + (disResult.rebalanced ? 1 : 0),
      duration_ms: Date.now() - startTime,
    });

    return NextResponse.json({
      ok: true,
      accumulation: { rebalanced: accResult.rebalanced, reason: accResult.reason },
      distribution: { rebalanced: disResult.rebalanced, reason: disResult.reason },
      highImpactNews: highImpactCount,
      ms: Date.now() - startTime,
    });
  } catch (error) {
    await supabase.from("scraper_runs").insert({
      scraper_name: "ilas_weekly_debate",
      status: "failed",
      error_message: error instanceof Error ? error.message : "Unknown error",
      duration_ms: Date.now() - startTime,
    });

    await sendDiscordAlert({
      title: "ILAS Track -- Weekly Debate Failed",
      description: `**Error:** ${sanitizeError(error)}\n**Duration:** ${Date.now() - startTime}ms`,
      color: COLORS.red,
    });

    return NextResponse.json({ error: "Weekly debate failed" }, { status: 500 });
  }
}
