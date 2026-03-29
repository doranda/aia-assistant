import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { extractKeywords } from "@/lib/search";
import { canManageTeam } from "@/lib/permissions";
import type { UserRole } from "@/lib/types";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data, error } = await supabase
      .from("faqs")
      .select("*")
      .order("use_count", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  } catch (err) {
    console.error("[faq GET] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!canManageTeam((profile?.role || "agent") as UserRole)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const { question, answer, sources } = body as { question: string; answer: string; sources: unknown };

    if (!question?.trim() || !answer?.trim()) {
      return NextResponse.json({ error: "Question and answer are required" }, { status: 400 });
    }

    const keywords = extractKeywords(question);

    const { data, error } = await supabase
      .from("faqs")
      .insert({
        question,
        answer,
        keywords,
        sources: sources || null,
        created_by: user.id,
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  } catch (err) {
    console.error("[faq POST] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
