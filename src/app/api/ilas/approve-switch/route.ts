import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
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

    // Check admin role
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (profileError) console.error("[ilas/approve-switch] profile query failed:", profileError);

    if (profile?.role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const { order_id, token } = body as { order_id: string; token: string };

    if (!order_id || !token) {
      return NextResponse.json(
        { error: "Missing order_id or token" },
        { status: 400 }
      );
    }

    try {
      const result = await approveIlasSwitch(order_id, token);
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
