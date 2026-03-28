// src/app/api/mpf/insights/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: insight } = await supabase
      .from("mpf_insights")
      .select("id, status, content_en, content_zh, type, trigger, created_at")
      .eq("id", id)
      .single();

    if (!insight) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json(insight);
  } catch (err) {
    console.error("[mpf/insights/[id] GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
