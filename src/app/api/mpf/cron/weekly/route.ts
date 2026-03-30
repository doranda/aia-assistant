// src/app/api/mpf/cron/weekly/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateInsight } from "@/lib/mpf/insights";
import { sendDiscordAlert, sanitizeError, COLORS } from "@/lib/discord";
import { getConsecutiveFailures } from "@/lib/mpf/health";

export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const startTime = Date.now();

  const { data: run, error: runError } = await supabase
    .from("scraper_runs")
    .insert({ scraper_name: "weekly_insight", status: "running" })
    .select()
    .single();

  if (runError) console.error("[weekly-cron] scraper_runs insert failed:", runError);

  try {
    // Create pending insight
    const { data: insight } = await supabase
      .from("mpf_insights")
      .insert({
        type: "weekly",
        trigger: "weekly_cron",
        status: "pending",
      })
      .select()
      .single();

    if (!insight) {
      throw new Error("Failed to create insight row");
    }

    // Generate (this takes ~40s per language, ~80s total)
    await generateInsight(insight.id);

    await supabase
      .from("scraper_runs")
      .update({
        status: "success",
        records_processed: 1,
        duration_ms: Date.now() - startTime,
      })
      .eq("id", run?.id);

    return NextResponse.json({ ok: true, insightId: insight.id });
  } catch (error) {
    await supabase
      .from("scraper_runs")
      .update({
        status: "failed",
        error_message: error instanceof Error ? error.message : "Unknown error",
        duration_ms: Date.now() - startTime,
      })
      .eq("id", run?.id);

    const failures = await getConsecutiveFailures(supabase, "weekly_insight");
    const isEscalated = failures >= 2;
    await sendDiscordAlert({
      title: `${isEscalated ? "\ud83d\udd34" : "\u274c"} MPF Care \u2014 Weekly Insight Failed`,
      description: [
        `**Error:** ${sanitizeError(error)}`,
        `**Consecutive failures:** ${failures}`,
        `**Duration:** ${Date.now() - startTime}ms`,
      ].join("\n"),
      color: COLORS.red,
    });

    return NextResponse.json({ error: "Weekly insight failed" }, { status: 500 });
  }
}
