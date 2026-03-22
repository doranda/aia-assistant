// src/app/api/mpf/cron/weekly/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateInsight } from "@/lib/mpf/insights";

export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

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
    return NextResponse.json({ error: "Failed to create insight" }, { status: 500 });
  }

  // Generate (this takes ~40s per language, ~80s total)
  await generateInsight(insight.id);

  return NextResponse.json({ ok: true, insightId: insight.id });
}
