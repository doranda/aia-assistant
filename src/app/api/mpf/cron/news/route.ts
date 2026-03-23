// src/app/api/mpf/cron/news/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchNews } from "@/lib/mpf/scrapers/news-collector";
import { classifyUnclassifiedNews } from "@/lib/mpf/classification";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();

  try {
    // Step 1: Fetch news (~15-20s)
    const fetched = await fetchNews();

    // Classification runs via separate /api/mpf/classify endpoint
    const classified = 0;

    const supabase = createAdminClient();
    await supabase.from("scraper_runs").insert({
      scraper_name: "news_collector",
      status: "success",
      records_processed: fetched + classified,
      duration_ms: Date.now() - startTime,
    });

    return NextResponse.json({ ok: true, fetched, classified, ms: Date.now() - startTime });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed", ms: Date.now() - startTime },
      { status: 500 }
    );
  }
}
