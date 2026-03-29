import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { approveSwitch } from "@/lib/mpf/portfolio-tracker";

export async function POST(req: NextRequest) {
  // Auth: require logged-in admin
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check admin role
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profileError) console.error("[approve-switch] profile query failed:", profileError);

  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { switch_id, token } = body as { switch_id: string; token: string };

  if (!switch_id || !token) {
    return NextResponse.json(
      { error: "Missing switch_id or token" },
      { status: 400 }
    );
  }

  try {
    const result = await approveSwitch(switch_id, token);
    return NextResponse.json({
      ok: true,
      message: `Emergency switch approved. Sells ${result.sellDate}, settles ${result.settlementDate}.`,
      ...result,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
