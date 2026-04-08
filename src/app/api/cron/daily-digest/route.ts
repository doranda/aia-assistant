// Daily 9am HK digest — single Discord message summarizing portfolio activity
// over the last 24h. Goes to the INFO channel (no @here ping).
//
// Schedule: 0 1 * * *  → 09:00 HK time
//
// Purpose: morning signal that the system is alive. Lists settlements,
// pending switches, awaiting-approval requests, and any blockers from the
// previous day for both MPF Care and ILAS Track.

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendDiscordAlert, COLORS } from "@/lib/discord";

export const maxDuration = 60;

interface SwitchRow {
  id: string;
  status: string;
  is_emergency: boolean | null;
  decision_date: string | null;
  settlement_date: string | null;
  settled_at: string | null;
  expires_at: string | null;
}

interface IlasOrderRow {
  id: string;
  portfolio_type: string;
  status: string;
  is_emergency: boolean | null;
  decision_date: string | null;
  settlement_date: string | null;
  settled_at: string | null;
  expires_at: string | null;
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const t0 = Date.now();
  const supabase = createAdminClient();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const todayHK = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Hong_Kong" });

  try {
    // ===== MPF =====
    const { data: mpfRows, error: mpfErr } = await supabase
      .from("mpf_pending_switches")
      .select("id, status, is_emergency, decision_date, settlement_date, settled_at, expires_at")
      .or(`settled_at.gte.${since},created_at.gte.${since}`);
    if (mpfErr) console.error("[daily-digest] mpf query failed:", mpfErr);
    const mpf = (mpfRows || []) as SwitchRow[];

    const mpfSettled = mpf.filter((r) => r.status === "settled" && r.settled_at && r.settled_at >= since);
    const mpfPending = mpf.filter((r) => r.status === "pending");
    const mpfAwaiting = mpf.filter((r) => r.status === "awaiting_approval");
    const mpfEmergency = mpf.filter((r) => r.is_emergency);

    // Most recent NAV row
    const { data: mpfNavRow, error: mpfNavErr } = await supabase
      .from("mpf_portfolio_nav")
      .select("date, nav, daily_return_pct")
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (mpfNavErr) console.error("[daily-digest] mpf nav query failed:", mpfNavErr);

    // ===== ILAS =====
    const { data: ilasRows, error: ilasErr } = await supabase
      .from("ilas_portfolio_orders")
      .select("id, portfolio_type, status, is_emergency, decision_date, settlement_date, settled_at, expires_at")
      .or(`settled_at.gte.${since},created_at.gte.${since}`);
    if (ilasErr) console.error("[daily-digest] ilas query failed:", ilasErr);
    const ilas = (ilasRows || []) as IlasOrderRow[];

    const ilasSettled = ilas.filter((r) => r.status === "executed" && r.settled_at && r.settled_at >= since);
    const ilasPending = ilas.filter((r) => r.status === "pending");
    const ilasAwaiting = ilas.filter((r) => r.status === "awaiting_approval");
    const ilasEmergency = ilas.filter((r) => r.is_emergency);

    // Build digest
    const lines: string[] = [];

    // MPF section
    lines.push("**📈 MPF Care**");
    if (mpfNavRow) {
      const ret = mpfNavRow.daily_return_pct != null ? Number(mpfNavRow.daily_return_pct) : null;
      const retStr = ret != null ? ` (${ret >= 0 ? "+" : ""}${ret.toFixed(2)}% daily)` : "";
      lines.push(`NAV ${Number(mpfNavRow.nav).toFixed(4)} as of ${mpfNavRow.date}${retStr}`);
    } else {
      lines.push("_No NAV row found._");
    }
    lines.push(
      `• Settled (24h): **${mpfSettled.length}**${mpfSettled.length > 0 ? ` ${mpfSettled.map((r) => r.id.slice(0, 8)).join(", ")}` : ""}`
    );
    lines.push(`• Pending: **${mpfPending.length}**${mpfPending.length > 0 ? ` (next: ${mpfPending[0].settlement_date})` : ""}`);
    lines.push(`• Awaiting approval: **${mpfAwaiting.length}**${mpfAwaiting.length > 0 ? ` ⚠️ check approval link` : ""}`);
    if (mpfEmergency.length > 0) {
      lines.push(`• 🚨 Emergency moves in window: ${mpfEmergency.length}`);
    }

    lines.push("");

    // ILAS section
    lines.push("**📊 ILAS Track**");
    const acc = ilas.filter((r) => r.portfolio_type === "accumulation");
    const dis = ilas.filter((r) => r.portfolio_type === "distribution");
    const accSettled = acc.filter((r) => r.status === "executed" && r.settled_at && r.settled_at >= since);
    const accPending = acc.filter((r) => r.status === "pending");
    const accAwaiting = acc.filter((r) => r.status === "awaiting_approval");
    const disSettled = dis.filter((r) => r.status === "executed" && r.settled_at && r.settled_at >= since);
    const disPending = dis.filter((r) => r.status === "pending");
    const disAwaiting = dis.filter((r) => r.status === "awaiting_approval");

    lines.push(`• Accumulation — settled: ${accSettled.length}, pending: ${accPending.length}, awaiting: ${accAwaiting.length}`);
    lines.push(`• Distribution — settled: ${disSettled.length}, pending: ${disPending.length}, awaiting: ${disAwaiting.length}`);
    if (ilasEmergency.length > 0) {
      lines.push(`• 🚨 Emergency moves in window: ${ilasEmergency.length}`);
    }

    lines.push("");

    // Health note — if everything is zero, system is quiet
    const totalActivity = mpfSettled.length + mpfPending.length + mpfAwaiting.length + ilasSettled.length + ilasPending.length + ilasAwaiting.length;
    if (totalActivity === 0) {
      lines.push("_System quiet — no activity in the last 24h._");
    }

    // Action items if anything is awaiting approval
    if (mpfAwaiting.length + ilasAwaiting.length > 0) {
      lines.push("");
      lines.push(`⚠️ **Action needed:** ${mpfAwaiting.length + ilasAwaiting.length} request(s) awaiting your approval. Check #aia-alerts-urgent or the dashboard.`);
    }

    await sendDiscordAlert({
      title: `🌅 AIA Morning Digest — ${todayHK}`,
      description: lines.join("\n").slice(0, 1900),
      color: COLORS.green,
    });

    return NextResponse.json({
      ok: true,
      date: todayHK,
      mpf: {
        settled: mpfSettled.length,
        pending: mpfPending.length,
        awaiting: mpfAwaiting.length,
        emergency: mpfEmergency.length,
      },
      ilas: {
        accSettled: accSettled.length,
        accPending: accPending.length,
        disSettled: disSettled.length,
        disPending: disPending.length,
        emergency: ilasEmergency.length,
      },
      ms: Date.now() - t0,
    });
  } catch (error) {
    console.error("[daily-digest] Cron failed:", error);
    await sendDiscordAlert(
      {
        title: "❌ Daily Digest Cron Failed",
        description: `Error: ${error instanceof Error ? error.message : "Unknown"}\nDuration: ${Date.now() - t0}ms`,
        color: COLORS.red,
      },
      { urgent: true }
    );
    return NextResponse.json({ error: "Daily digest failed" }, { status: 500 });
  }
}
