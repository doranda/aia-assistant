// src/app/api/ilas/seed/route.ts
// Admin-only, one-time seed of ilas_funds from constants.
// Idempotent — uses ON CONFLICT to update existing rows.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { AIA_ILAS_FUNDS } from "@/lib/ilas/constants";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

  // Batch upsert all funds in one call
  const rows = AIA_ILAS_FUNDS.map((fund) => ({
    fund_code: fund.fund_code,
    aia_fund_code: fund.fund_code,
    name_en: fund.name_en,
    category: fund.category,
    risk_rating: fund.risk_rating,
    currency: fund.currency,
    is_distribution: fund.is_distribution,
    fund_house: fund.fund_house,
    fund_size: fund.fund_size || null,
    settlement_days: 3,
    is_active: true,
  }));

  const { error } = await supabase
    .from("ilas_funds")
    .upsert(rows, { onConflict: "fund_code" });

  if (error) {
    console.error("[ilas-seed] Batch upsert failed:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // Check final count
  const { count } = await supabase
    .from("ilas_funds")
    .select("*", { count: "exact", head: true });

  return NextResponse.json({
    ok: true,
    seeded: rows.length,
    total_in_db: count,
    total_in_constants: AIA_ILAS_FUNDS.length,
  });
}
