import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { approveSwitch } from "@/lib/mpf/portfolio-tracker";

export async function POST(req: NextRequest) {
  try {
    // Auth: require logged-in admin
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check admin role — fail closed on DB errors so admins aren't 403'd by transient failures
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (profileError) {
      console.error("[mpf/approve-switch] profile query failed:", profileError);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    if (profile?.role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const { switch_id } = body as { switch_id: string };

    if (!switch_id) {
      return NextResponse.json({ error: "Missing switch_id" }, { status: 400 });
    }

    // Server-side token resolution: never trust a client-supplied token.
    // Admin session is the trust boundary; the token only exists to satisfy
    // the existing approveSwitch() signature (single-use, cleared on approval).
    const admin = createAdminClient();
    const { data: row, error: rowError } = await admin
      .from("mpf_pending_switches")
      .select("confirmation_token")
      .eq("id", switch_id)
      .eq("status", "awaiting_approval")
      .single();
    if (rowError || !row || !row.confirmation_token) {
      return NextResponse.json({ error: "Switch not found or already actioned" }, { status: 404 });
    }

    try {
      const result = await approveSwitch(switch_id, row.confirmation_token);
      return NextResponse.json({
        ok: true,
        message: `Emergency switch approved. Sells ${result.sellDate}, settles ${result.settlementDate}.`,
        ...result,
      });
    } catch (e) {
      console.error("[mpf/approve-switch] error:", e);
      return NextResponse.json({ error: "Switch approval failed" }, { status: 400 });
    }
  } catch (err) {
    console.error("[mpf/approve-switch] POST error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
