import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data, error } = await supabase
      .from("popular_queries")
      .select("query_text, count")
      .order("count", { ascending: false })
      .limit(6);
    if (error) console.error("[popular-queries] query failed:", error);

    return NextResponse.json(data || []);
  } catch (err) {
    console.error("[popular-queries GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
