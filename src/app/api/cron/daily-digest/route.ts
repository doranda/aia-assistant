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
import { sendDiscordAlert, COLORS, sanitizeError } from "@/lib/discord";
import { runReconciliationAlerts } from "@/lib/portfolio/reconciliation-alerts";

export const dynamic = "force-dynamic";
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

  // Track sub-query errors so we don't silently report zeros
  const subErrors: string[] = [];

  try {
    // ===== MPF =====
    // Two queries: one for 24h settlements, one for all currently-active rows.
    // A single OR query on (settled_at.gte, created_at.gte) would miss switches
    // created >24h ago that are still pending/awaiting — exactly when the admin
    // most needs to see them in the morning digest.
    const { data: mpfSettledRows, error: mpfSettledErr } = await supabase
      .from("mpf_pending_switches")
      .select("id, status, is_emergency, decision_date, settlement_date, settled_at, expires_at")
      .eq("status", "settled")
      .gte("settled_at", since);
    if (mpfSettledErr) {
      console.error("[daily-digest] mpf settled query failed:", mpfSettledErr);
      subErrors.push(`mpf_pending_switches (settled): ${mpfSettledErr.message}`);
    }

    const { data: mpfActiveRows, error: mpfActiveErr } = await supabase
      .from("mpf_pending_switches")
      .select("id, status, is_emergency, decision_date, settlement_date, settled_at, expires_at")
      .in("status", ["pending", "awaiting_approval"])
      .order("settlement_date", { ascending: true, nullsFirst: false });
    if (mpfActiveErr) {
      console.error("[daily-digest] mpf active query failed:", mpfActiveErr);
      subErrors.push(`mpf_pending_switches (active): ${mpfActiveErr.message}`);
    }

    // Executed rows — awaiting NAV reconciliation (new optimistic settlement state)
    const { data: mpfExecutedRows, error: mpfExecutedErr } = await supabase
      .from("mpf_pending_switches")
      .select("id, status, is_emergency, decision_date, settlement_date, settled_at, expires_at")
      .eq("status", "executed")
      .is("reconciled_at", null);
    if (mpfExecutedErr) {
      console.error("[daily-digest] mpf executed query failed:", mpfExecutedErr);
      subErrors.push(`mpf_pending_switches (executed): ${mpfExecutedErr.message}`);
    }

    const mpfSettled = (mpfSettledRows || []) as SwitchRow[];
    const mpfActive = (mpfActiveRows || []) as SwitchRow[];
    const mpfExecuted = (mpfExecutedRows || []) as SwitchRow[];
    const mpfPending = mpfActive.filter((r) => r.status === "pending");
    const mpfAwaiting = mpfActive.filter((r) => r.status === "awaiting_approval");
    const mpfEmergency = [...mpfSettled, ...mpfActive, ...mpfExecuted].filter((r) => r.is_emergency);

    // Most recent NAV row
    const { data: mpfNavRow, error: mpfNavErr } = await supabase
      .from("mpf_portfolio_nav")
      .select("date, nav, daily_return_pct")
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (mpfNavErr) {
      console.error("[daily-digest] mpf nav query failed:", mpfNavErr);
      subErrors.push(`mpf_portfolio_nav: ${mpfNavErr.message}`);
    }

    // ===== ILAS =====
    // Same split as MPF — one query per state window.
    const { data: ilasSettledRows, error: ilasSettledErr } = await supabase
      .from("ilas_portfolio_orders")
      .select("id, portfolio_type, status, is_emergency, decision_date, settlement_date, settled_at, expires_at")
      .eq("status", "settled")
      .gte("settled_at", since);
    if (ilasSettledErr) {
      console.error("[daily-digest] ilas settled query failed:", ilasSettledErr);
      subErrors.push(`ilas_portfolio_orders (settled): ${ilasSettledErr.message}`);
    }

    const { data: ilasActiveRows, error: ilasActiveErr } = await supabase
      .from("ilas_portfolio_orders")
      .select("id, portfolio_type, status, is_emergency, decision_date, settlement_date, settled_at, expires_at")
      .in("status", ["pending", "awaiting_approval"])
      .order("settlement_date", { ascending: true, nullsFirst: false });
    if (ilasActiveErr) {
      console.error("[daily-digest] ilas active query failed:", ilasActiveErr);
      subErrors.push(`ilas_portfolio_orders (active): ${ilasActiveErr.message}`);
    }

    // Executed rows — awaiting NAV reconciliation
    const { data: ilasExecutedRows, error: ilasExecutedErr } = await supabase
      .from("ilas_portfolio_orders")
      .select("id, portfolio_type, status, is_emergency, decision_date, settlement_date, settled_at, expires_at")
      .eq("status", "executed")
      .is("reconciled_at", null);
    if (ilasExecutedErr) {
      console.error("[daily-digest] ilas executed query failed:", ilasExecutedErr);
      subErrors.push(`ilas_portfolio_orders (executed): ${ilasExecutedErr.message}`);
    }

    const ilasSettled = (ilasSettledRows || []) as IlasOrderRow[];
    const ilasActive = (ilasActiveRows || []) as IlasOrderRow[];
    const ilasExecuted = (ilasExecutedRows || []) as IlasOrderRow[];
    const ilas = [...ilasSettled, ...ilasActive, ...ilasExecuted];
    const ilasPending = ilasActive.filter((r) => r.status === "pending");
    const ilasAwaiting = ilasActive.filter((r) => r.status === "awaiting_approval");
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
    lines.push(`• Executed (awaiting NAV): **${mpfExecuted.length}**${mpfExecuted.length > 0 ? ` — typical 4-6 biz days` : ""}`);
    lines.push(`• Pending: **${mpfPending.length}**${mpfPending.length > 0 ? ` (next: ${mpfPending[0].settlement_date})` : ""}`);
    lines.push(`• Awaiting approval: **${mpfAwaiting.length}**${mpfAwaiting.length > 0 ? ` ⚠️ check approval link` : ""}`);
    if (mpfEmergency.length > 0) {
      lines.push(`• 🚨 Emergency moves in window: ${mpfEmergency.length}`);
    }

    lines.push("");

    // ILAS section
    lines.push("**📊 ILAS Track**");
    const accSettled = ilasSettled.filter((r) => r.portfolio_type === "accumulation");
    const accExecuted = ilasExecuted.filter((r) => r.portfolio_type === "accumulation");
    const accPending = ilasPending.filter((r) => r.portfolio_type === "accumulation");
    const accAwaiting = ilasAwaiting.filter((r) => r.portfolio_type === "accumulation");
    const disSettled = ilasSettled.filter((r) => r.portfolio_type === "distribution");
    const disExecuted = ilasExecuted.filter((r) => r.portfolio_type === "distribution");
    const disPending = ilasPending.filter((r) => r.portfolio_type === "distribution");
    const disAwaiting = ilasAwaiting.filter((r) => r.portfolio_type === "distribution");

    lines.push(`• Accumulation — settled: ${accSettled.length}, executed: ${accExecuted.length}, pending: ${accPending.length}, awaiting: ${accAwaiting.length}`);
    lines.push(`• Distribution — settled: ${disSettled.length}, executed: ${disExecuted.length}, pending: ${disPending.length}, awaiting: ${disAwaiting.length}`);
    if (ilasEmergency.length > 0) {
      lines.push(`• 🚨 Emergency moves in window: ${ilasEmergency.length}`);
    }

    lines.push("");

    // Health note — if everything is zero, system is quiet
    const totalActivity = mpfSettled.length + mpfExecuted.length + mpfPending.length + mpfAwaiting.length + ilasSettled.length + ilasExecuted.length + ilasPending.length + ilasAwaiting.length;
    if (totalActivity === 0) {
      lines.push("_System quiet — no activity in the last 24h._");
    }

    // Action items if anything is awaiting approval
    if (mpfAwaiting.length + ilasAwaiting.length > 0) {
      lines.push("");
      lines.push(`⚠️ **Action needed:** ${mpfAwaiting.length + ilasAwaiting.length} request(s) awaiting your approval. Check #aia-alerts-urgent or the dashboard.`);
    }

    // If any sub-query failed, fire an urgent alert BEFORE the digest so the
    // admin doesn't mistake a degraded digest for an all-quiet morning.
    // Also prefix the main digest title with ⚠️ DEGRADED so the visual signal
    // is inside the message that *did* arrive — even if the urgent alert itself
    // fails to send (webhook down, rate-limited, etc).
    const degraded = subErrors.length > 0;
    if (degraded) {
      const sentUrgent = await sendDiscordAlert(
        {
          title: "🔴 Daily Digest — Partial Data (sub-query failures)",
          description: `The morning digest is about to post but ${subErrors.length} sub-query failed:\n\n${subErrors.map((e) => `• ${sanitizeError(e)}`).join("\n")}\n\nCounts below may be underreported.`,
          color: COLORS.red,
        },
        { urgent: true }
      );
      if (!sentUrgent) {
        console.error("[daily-digest] Urgent partial-data alert failed to send — degraded marker in main digest title is the fallback signal");
      }
    }

    await sendDiscordAlert({
      title: degraded
        ? `⚠️ DEGRADED — AIA Morning Digest — ${todayHK}`
        : `🌅 AIA Morning Digest — ${todayHK}`,
      description: lines.join("\n").slice(0, 1900),
      color: degraded ? COLORS.yellow : COLORS.green,
    });

    // Run reconciliation alerts for executed rows stuck too long
    let reconAlerts = { warned: 0, urgent: 0 };
    try {
      reconAlerts = await runReconciliationAlerts();
    } catch (reconErr) {
      console.error("[daily-digest] reconciliation alerts failed:", reconErr);
    }

    return NextResponse.json({
      ok: true,
      degraded,
      subErrors: subErrors.length,
      reconAlerts,
      date: todayHK,
      mpf: {
        settled: mpfSettled.length,
        executed: mpfExecuted.length,
        pending: mpfPending.length,
        awaiting: mpfAwaiting.length,
        emergency: mpfEmergency.length,
      },
      ilas: {
        accSettled: accSettled.length,
        accExecuted: accExecuted.length,
        accPending: accPending.length,
        disSettled: disSettled.length,
        disExecuted: disExecuted.length,
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
        description: `Error: ${sanitizeError(error)}\nDuration: ${Date.now() - t0}ms`,
        color: COLORS.red,
      },
      { urgent: true }
    );
    return NextResponse.json({ error: "Daily digest failed" }, { status: 500 });
  }
}
