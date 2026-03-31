// src/app/api/mpf/upload/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canUploadMpfData } from "@/lib/permissions";
import { upsertPrices } from "@/lib/mpf/scrapers/fund-prices";
import ExcelJS from "exceljs";
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

    // File size limit: 10MB for spreadsheets
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "File exceeds 10MB limit" }, { status: 400 });
    }

    let rows: { fund_code: string; date: string; nav: number }[];
    try {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(arrayBuffer);
      const sheet = workbook.worksheets[0];
      if (!sheet) throw new Error("No worksheet found");

      const headers: string[] = [];
      rows = [];
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) {
          row.eachCell((cell, colNumber) => {
            headers[colNumber] = String(cell.value ?? "").toLowerCase().trim();
          });
          return;
        }
        const obj: Record<string, unknown> = {};
        row.eachCell((cell, colNumber) => {
          obj[headers[colNumber]] = cell.value;
        });
        if (obj.fund_code && obj.date && obj.nav) {
          const rawDate = obj.date;
          const dateStr = rawDate instanceof Date
            ? rawDate.toISOString().slice(0, 10)
            : String(rawDate);
          rows.push({
            fund_code: String(obj.fund_code),
            date: dateStr,
            nav: Number(obj.nav),
          });
        }
      });
    } catch (err) {
      console.error("[upload] Excel parse error:", err);
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
