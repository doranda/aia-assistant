// src/app/api/mpf/cron/news/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchNews } from "@/lib/mpf/scrapers/news-collector";
import { classifyUnclassifiedNews } from "@/lib/mpf/classification";

export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const startTime = Date.now();

  const { data: run } = await supabase
    .from("scraper_runs")
    .insert({ scraper_name: "news_collector", status: "running" })
    .select()
    .single();

  try {
    // Step 1: Fetch news
    const fetched = await fetchNews();

    // Step 2: Classify unclassified news
    const classified = await classifyUnclassifiedNews();

    // Step 3: Check for high-impact news → trigger insight
    const { data: highImpact } = await supabase
      .from("mpf_news")
      .select("id")
      .eq("is_high_impact", true)
      .gte("created_at", new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString())
      .limit(1);

    if (highImpact && highImpact.length > 0) {
      // Check if we already have a recent alert insight
      const { count: recentAlerts } = await supabase
        .from("mpf_insights")
        .select("*", { count: "exact", head: true })
        .eq("type", "alert")
        .gte("created_at", new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString());

      if (!recentAlerts || recentAlerts === 0) {
        await supabase.from("mpf_insights").insert({
          type: "alert",
          trigger: "high_impact_news",
          status: "pending",
        });
      }
    }

    await supabase
      .from("scraper_runs")
      .update({
        status: "success",
        records_processed: fetched + classified,
        duration_ms: Date.now() - startTime,
      })
      .eq("id", run?.id);

    return NextResponse.json({ ok: true, fetched, classified });
  } catch (error) {
    await supabase
      .from("scraper_runs")
      .update({
        status: "failed",
        error_message: error instanceof Error ? error.message : "Unknown error",
        duration_ms: Date.now() - startTime,
      })
      .eq("id", run?.id);

    return NextResponse.json({ error: "News collection failed" }, { status: 500 });
  }
}
