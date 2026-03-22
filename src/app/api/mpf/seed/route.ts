// src/app/api/mpf/seed/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { AIA_FUNDS } from "@/lib/mpf/constants";
import type { UserRole } from "@/lib/types";

export async function POST(req: NextRequest) {
  // Admin-only
  const supabaseAuth = await createClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabaseAuth
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if ((profile?.role as UserRole) !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const supabase = createAdminClient();

  // Check if already seeded
  const { count } = await supabase
    .from("mpf_funds")
    .select("*", { count: "exact", head: true });

  if (count && count > 0) {
    return NextResponse.json({ message: "Already seeded", count }, { status: 200 });
  }

  const { data, error } = await supabase
    .from("mpf_funds")
    .insert(AIA_FUNDS.map((f) => ({
      fund_code: f.fund_code,
      name_en: f.name_en,
      name_zh: f.name_zh,
      category: f.category,
      risk_rating: f.risk_rating,
    })))
    .select();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ message: "Seeded", count: data.length });
}
