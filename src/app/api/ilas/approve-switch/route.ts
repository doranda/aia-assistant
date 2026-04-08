import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { approveIlasSwitch } from "@/lib/ilas/portfolio-tracker";

export async function POST(req: NextRequest) {
  try {
    // Auth: require logged-in admin
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
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
      console.error("[ilas/approve-switch] profile query failed:", profileError);
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
    const { order_id } = body as { order_id: string };

    if (!order_id) {
      return NextResponse.json({ error: "Missing order_id" }, { status: 400 });
    }

    // Server-side token resolution: admin session IS the trust boundary;
    // never trust a client-supplied token.
    const admin = createAdminClient();
    const { data: row, error: rowError } = await admin
      .from("ilas_portfolio_orders")
      .select("confirmation_token")
      .eq("id", order_id)
      .eq("status", "awaiting_approval")
      .single();
    if (rowError || !row || !row.confirmation_token) {
      return NextResponse.json({ error: "Order not found or already actioned" }, { status: 404 });
    }

    try {
      const result = await approveIlasSwitch(order_id, row.confirmation_token);
      return NextResponse.json({
        ok: true,
        message: `ILAS emergency order approved. Sells ${result.sellDate}, settles ${result.settlementDate}.`,
        ...result,
      });
    } catch (e) {
      console.error("[ilas/approve-switch] error:", e);
      return NextResponse.json({ error: "Order approval failed" }, { status: 400 });
    }
  } catch (err) {
    console.error("[ilas/approve-switch] POST error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
