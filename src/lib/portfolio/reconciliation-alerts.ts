// src/lib/portfolio/reconciliation-alerts.ts
// Three-tier reconciliation alerts for executed orders awaiting NAV.
//
// Normal flow: executed → reconciled in ~5 biz days.
// WARNING at 7 biz days  → info channel (no ping)
// URGENT at 10 biz days  → urgent channel (@here)

import { createAdminClient } from "@/lib/supabase/admin";
import { sendDiscordAlert, COLORS } from "@/lib/discord";
import { loadHKHolidays, bizDaysBetween } from "./business-days";

const WARNING_THRESHOLD_BD = 7;
const URGENT_THRESHOLD_BD = 10;

export async function runReconciliationAlerts(): Promise<{
  warned: number;
  urgent: number;
}> {
  const supabase = createAdminClient();
  const holidays = await loadHKHolidays();
  const todayStr = new Date().toISOString().split("T")[0];
  let warned = 0;
  let urgent = 0;

  for (const table of [
    "mpf_pending_switches",
    "ilas_portfolio_orders",
  ] as const) {
    const { data: rows, error: queryErr } = await supabase
      .from(table)
      .select("id, executed_at")
      .eq("status", "executed")
      .is("reconciled_at", null);

    if (queryErr) {
      console.error(`[reconciliation-alerts] Failed to query ${table}:`, queryErr.message);
      continue;
    }

    for (const row of rows || []) {
      if (!row.executed_at) continue;
      const execDate = new Date(row.executed_at).toISOString().split("T")[0];

      // Guard: if execDate is in the future or same day, skip
      if (execDate >= todayStr) continue;

      const bd = bizDaysBetween(execDate, todayStr, holidays);
      const label =
        table === "mpf_pending_switches" ? "MPF switch" : "ILAS order";

      if (bd >= URGENT_THRESHOLD_BD) {
        await sendDiscordAlert(
          {
            title: `🚨 Reconciliation URGENT: ${label} ${row.id.slice(0, 8)}`,
            description: `${bd} biz days in executed state (threshold: ${URGENT_THRESHOLD_BD}). Row ${row.id} in ${table} — executed ${execDate}. Investigate immediately.`,
            color: COLORS.red,
          },
          { urgent: true },
        );
        urgent++;
      } else if (bd >= WARNING_THRESHOLD_BD) {
        await sendDiscordAlert({
          title: `⚠️ Reconciliation warning: ${label} ${row.id.slice(0, 8)}`,
          description: `${bd} biz days in executed state (normal: 0–6). Row ${row.id} in ${table} — executed ${execDate}. NAV may be delayed.`,
          color: COLORS.yellow,
        });
        warned++;
      }
    }
  }

  return { warned, urgent };
}
