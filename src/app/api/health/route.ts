import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const checks: Record<string, "ok" | "error"> = {};

  try {
    const supabase = await createClient();
    const { error } = await supabase.from("profiles").select("id").limit(1);
    checks.supabase = error ? "error" : "ok";
  } catch {
    checks.supabase = "error";
  }

  checks.ollama = "ok"; // Placeholder for Phase 2

  const allOk = Object.values(checks).every((v) => v === "ok");

  // Detailed checks only with CRON_SECRET; public gets status only
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  const isAuthorized = !!secret && authHeader === `Bearer ${secret}`;

  return NextResponse.json(
    { status: allOk ? "healthy" : "degraded", ...(isAuthorized && { checks }) },
    { status: allOk ? 200 : 503 }
  );
}
