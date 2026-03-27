// src/app/api/mpf/rebalance-history/route.ts
// GET — returns all rebalance history ordered by rebalanced_at DESC

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("mpf_rebalance_history")
      .select("*")
      .order("rebalanced_at", { ascending: false });

    if (error) {
      // If the table doesn't exist yet (migration not applied), return empty
      if (error.code === "42P01") {
        return NextResponse.json({ history: [] });
      }
      throw error;
    }

    return NextResponse.json({ history: data ?? [] });
  } catch (err) {
    console.error("[rebalance-history] GET error:", err);
    return NextResponse.json(
      { error: "Failed to fetch rebalance history" },
      { status: 500 }
    );
  }
}
