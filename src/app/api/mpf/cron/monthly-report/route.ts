// Monthly portfolio performance report — fires on 1st working Monday of each month
// Sends YTD, MTD, and last-month summary to Discord

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendDiscordAlert, COLORS } from "@/lib/discord";
import { isWorkingDay, loadHKHolidays } from "@/lib/mpf/portfolio-tracker";
import { formatAllocation, FUND_CODE_TO_NAME } from "@/lib/mpf/constants";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request) {
  // Verify cron secret
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const hkt = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Hong_Kong" }));
  const today = hkt.toISOString().split("T")[0];

  // Only run on the first working Monday of the month
  const holidays = await loadHKHolidays();
  if (hkt.getDay() !== 1) {
    return NextResponse.json({ ok: true, skipped: true, reason: "Not Monday" });
  }

  // Check this is the FIRST Monday of the month (day 1-7)
  if (hkt.getDate() > 7) {
    return NextResponse.json({ ok: true, skipped: true, reason: "Not first week" });
  }

  // Verify it's a working day (not a holiday)
  if (!isWorkingDay(today, holidays)) {
    return NextResponse.json({ ok: true, skipped: true, reason: "Holiday" });
  }

  try {
  const supabase = createAdminClient();

  // ===== Date ranges =====
  const year = hkt.getFullYear();
  const month = hkt.getMonth(); // 0-indexed, current month
  const ytdStart = `${year}-01-01`;
  const lastMonthStart = new Date(year, month - 1, 1).toISOString().split("T")[0];
  const lastMonthEnd = new Date(year, month, 0).toISOString().split("T")[0]; // last day of prev month
  const mtdStart = new Date(year, month, 1).toISOString().split("T")[0]; // 1st of current month (will be very short)

  // ===== Fetch portfolio NAV data =====
  // YTD start NAV
  const { data: ytdStartNav, error: ytdErr } = await supabase
    .from("mpf_portfolio_nav")
    .select("nav, date")
    .gte("date", ytdStart)
    .order("date", { ascending: true })
    .limit(1)
    .single();

  if (ytdErr && ytdErr.code !== "PGRST116") console.error("[monthly-report] ytdStartNav error:", ytdErr);

  // Last month start NAV
  const { data: lastMonthStartNav, error: lmsErr } = await supabase
    .from("mpf_portfolio_nav")
    .select("nav, date")
    .gte("date", lastMonthStart)
    .lte("date", lastMonthEnd)
    .order("date", { ascending: true })
    .limit(1)
    .single();

  if (lmsErr && lmsErr.code !== "PGRST116") console.error("[monthly-report] lastMonthStartNav error:", lmsErr);

  // Last month end NAV
  const { data: lastMonthEndNav, error: lmeErr } = await supabase
    .from("mpf_portfolio_nav")
    .select("nav, date")
    .lte("date", lastMonthEnd)
    .order("date", { ascending: false })
    .limit(1)
    .single();

  if (lmeErr && lmeErr.code !== "PGRST116") console.error("[monthly-report] lastMonthEndNav error:", lmeErr);

  // Latest NAV (for MTD)
  const { data: latestNav, error: latestErr } = await supabase
    .from("mpf_portfolio_nav")
    .select("nav, date, holdings")
    .order("date", { ascending: false })
    .limit(1)
    .single();

  if (latestErr && latestErr.code !== "PGRST116") console.error("[monthly-report] latestNav error:", latestErr);

  // MTD start NAV (first nav of current month, if exists)
  const { data: mtdStartNav, error: mtdErr } = await supabase
    .from("mpf_portfolio_nav")
    .select("nav, date")
    .gte("date", mtdStart)
    .order("date", { ascending: true })
    .limit(1)
    .single();

  if (mtdErr && mtdErr.code !== "PGRST116") console.error("[monthly-report] mtdStartNav error:", mtdErr);

  if (!latestNav) {
    return NextResponse.json({ ok: false, error: "No portfolio NAV data" });
  }

  // ===== Calculate returns =====
  const ytdReturn = ytdStartNav
    ? (((latestNav.nav - ytdStartNav.nav) / ytdStartNav.nav) * 100).toFixed(2)
    : "N/A";

  const lastMonthReturn =
    lastMonthStartNav && lastMonthEndNav
      ? (((lastMonthEndNav.nav - lastMonthStartNav.nav) / lastMonthStartNav.nav) * 100).toFixed(2)
      : "N/A";

  const mtdReturn = mtdStartNav
    ? (((latestNav.nav - mtdStartNav.nav) / mtdStartNav.nav) * 100).toFixed(2)
    : "N/A";

  // ===== Last month switches =====
  const { data: lastMonthSwitches } = await supabase
    .from("mpf_pending_switches")
    .select("decision_date, old_allocation, new_allocation, status, settled_at")
    .gte("decision_date", lastMonthStart)
    .lte("decision_date", lastMonthEnd)
    .order("decision_date", { ascending: true });

  const switchCount = lastMonthSwitches?.length || 0;
  const settledCount = lastMonthSwitches?.filter((s) => s.status === "settled").length || 0;

  // ===== Current holdings =====
  let holdingsText = "No holdings data";
  if (latestNav.holdings && Array.isArray(latestNav.holdings)) {
    const holdings = latestNav.holdings as { code: string; weight: number }[];
    holdingsText = formatAllocation(holdings);
  }

  // ===== Switch details for last month =====
  let switchDetails = "";
  if (lastMonthSwitches && lastMonthSwitches.length > 0) {
    switchDetails = lastMonthSwitches
      .map((s) => {
        const oldAlloc = formatAllocation(s.old_allocation as { code: string; weight: number }[]);
        const newAlloc = formatAllocation(s.new_allocation as { code: string; weight: number }[]);
        return `• ${s.decision_date}: ${oldAlloc} → ${newAlloc} (${s.status})`;
      })
      .join("\n");
  }

  // ===== Month name =====
  const lastMonthName = new Date(year, month - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
  const currentMonthName = new Date(year, month, 1).toLocaleString("en-US", { month: "long", year: "numeric" });

  // ===== Send report =====
  await sendDiscordAlert({
    title: `📈 MPF Care — Monthly Report (${currentMonthName})`,
    description: [
      `**Portfolio NAV:** ${latestNav.nav.toFixed(4)} (as of ${latestNav.date})`,
      `**Current holdings:** ${holdingsText}`,
      "",
      "━━━ Performance ━━━",
      `**YTD:** ${ytdReturn}%${ytdStartNav ? ` (from ${ytdStartNav.date})` : ""}`,
      `**MTD:** ${mtdReturn}%`,
      `**Last month (${lastMonthName}):** ${lastMonthReturn}%`,
      "",
      "━━━ Last Month Summary ━━━",
      `**Switches:** ${switchCount} submitted, ${settledCount} settled`,
      switchDetails || "No switches last month",
    ].join("\n"),
    color: Number(ytdReturn) >= 0 ? COLORS.green : COLORS.red,
    fields: [
      { name: "YTD", value: `${ytdReturn}%`, inline: true },
      { name: "MTD", value: `${mtdReturn}%`, inline: true },
      { name: `${lastMonthName}`, value: `${lastMonthReturn}%`, inline: true },
    ],
  });

  return NextResponse.json({
    ok: true,
    report: {
      date: today,
      nav: latestNav.nav,
      ytd: ytdReturn,
      mtd: mtdReturn,
      lastMonth: lastMonthReturn,
      switches: switchCount,
    },
  });
  } catch (err) {
    console.error("[monthly-report] Unhandled error:", err);
    return NextResponse.json({ ok: false, error: "Monthly report failed" }, { status: 500 });
  }
}
