// src/app/api/mpf/refresh/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canTriggerMpfRefresh } from "@/lib/permissions";
import { scrapeAAStocksPrices, upsertPrices } from "@/lib/mpf/scrapers/fund-prices";
import { fetchNews } from "@/lib/mpf/scrapers/news-collector";
import { classifyUnclassifiedNews } from "@/lib/mpf/classification";
import type { UserRole } from "@/lib/types";

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profileError) {
      console.error("[mpf/refresh] profile query error:", profileError);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    if (!canTriggerMpfRefresh((profile?.role || "agent") as UserRole)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const prices = await scrapeAAStocksPrices();
    const priceCount = await upsertPrices(prices);
    const newsCount = await fetchNews();
    const classified = await classifyUnclassifiedNews();

    return NextResponse.json({ ok: true, prices: priceCount, news: newsCount, classified });
  } catch (error) {
    console.error("[mpf/refresh] POST error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Refresh failed" },
      { status: 500 }
    );
  }
}
