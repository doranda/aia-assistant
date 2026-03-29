// src/app/api/mpf/upload/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canUploadMpfData } from "@/lib/permissions";
import { upsertPrices } from "@/lib/mpf/scrapers/fund-prices";
import * as XLSX from "xlsx";
import type { UserRole } from "@/lib/types";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profileError) {
      console.error("[mpf/upload] profile query error:", profileError);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    if (!canUploadMpfData((profile?.role || "agent") as UserRole)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
    }
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

    let rows: { fund_code: string; date: string; nav: number }[];
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      const workbook = XLSX.read(buffer, { type: "buffer" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json<{ fund_code: string; date: string; nav: number }>(sheet);
    } catch (err) {
      console.error("[upload] XLSX parse error:", err);
      return NextResponse.json({ error: "Invalid spreadsheet format" }, { status: 400 });
    }

    const prices = rows
      .filter((r) => r.fund_code && r.date && r.nav)
      .map((r) => ({
        fund_code: r.fund_code,
        date: r.date,
        nav: Number(r.nav),
        source: "manual" as const,
      }));

    const count = await upsertPrices(prices);

    return NextResponse.json({ ok: true, count });
  } catch (err) {
    console.error("[mpf/upload] POST error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
