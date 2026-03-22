// src/app/api/mpf/insights/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canGenerateInsight } from "@/lib/permissions";
import { generateInsight } from "@/lib/mpf/insights";
import type { UserRole } from "@/lib/types";

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Check role
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const role = (profile?.role || "agent") as UserRole;
  if (!canGenerateInsight(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();

  // Create pending insight
  const { data: insight } = await admin
    .from("mpf_insights")
    .insert({
      type: "on_demand",
      trigger: `manual:${user.email}`,
      status: "pending",
    })
    .select()
    .single();

  if (!insight) {
    return NextResponse.json({ error: "Failed to create insight" }, { status: 500 });
  }

  // Fire and forget — don't await. Client polls via GET /api/mpf/insights/[id]
  generateInsight(insight.id).catch((e) => console.error("[mpf/insights] generation failed:", e));

  return NextResponse.json({ id: insight.id, status: "pending" });
}
