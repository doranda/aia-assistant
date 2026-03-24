import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendDiscordAlert, COLORS } from "@/lib/discord";
import {
  getPipelineStatus,
  getDataFreshness,
  getMissingData,
  getOutliers,
} from "@/lib/mpf/health";

export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

  const [pipeline, freshness, coverage, outliers] = await Promise.all([
    getPipelineStatus(supabase, 1),
    getDataFreshness(supabase),
    getMissingData(supabase, 7),
    getOutliers(supabase),
  ]);

  const hasFailures = pipeline.some((r) => r.status === "failed");
  const hasStale = freshness.some((f) => f.level === "red");
  const hasWarnings =
    freshness.some((f) => f.level === "yellow") || outliers.length > 0;

  const overallColor =
    hasFailures || hasStale
      ? COLORS.red
      : hasWarnings
        ? COLORS.yellow
        : COLORS.green;

  const pipelineText = ["fund_prices", "news_pipeline", "weekly_insight"]
    .map((name) => {
      const runs = pipeline.filter((r) => r.scraper_name === name);
      const latest = runs[0];
      const icon = !latest
        ? "⚪"
        : latest.status === "success"
          ? "✅"
          : "❌";
      const label =
        name === "fund_prices"
          ? "Prices"
          : name === "news_pipeline"
            ? "News"
            : "Insights";
      const detail = latest
        ? `${latest.records_processed} records (${latest.status})`
        : "no run in 24h";
      return `${icon} **${label}:** ${detail}`;
    })
    .join("\n");

  const freshnessText = freshness
    .map((f) => {
      const icon =
        f.level === "green" ? "✅" : f.level === "yellow" ? "⚠️" : "🔴";
      const age =
        f.hoursAgo === null
          ? "No data"
          : f.hoursAgo < 24
            ? `${f.hoursAgo}h ago`
            : `${Math.round(f.hoursAgo / 24)}d ago`;
      return `${icon} **${f.label}:** ${age}`;
    })
    .join("\n");

  const gapDays = coverage.filter(
    (d) => !d.isWeekend && d.fundCount < d.expectedCount * 0.8
  );
  const qualityLines = [
    outliers.length === 0
      ? "✅ No outliers"
      : `⚠️ ${outliers.length} outlier(s): ${outliers.map((o) => `${o.fund_code} ${o.daily_change_pct > 0 ? "+" : ""}${o.daily_change_pct.toFixed(1)}%`).join(", ")}`,
    gapDays.length === 0
      ? "✅ No gaps in last 7 days"
      : `⚠️ ${gapDays.length} day(s) with missing data`,
  ];

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.VERCEL_URL ||
    "localhost:3000";

  await sendDiscordAlert({
    title: `MPF Care Daily Report — ${new Date().toISOString().split("T")[0]}`,
    description: [
      "**Pipeline Status:**",
      pipelineText,
      "",
      "**Data Freshness:**",
      freshnessText,
      "",
      "**Data Quality:**",
      ...qualityLines,
      "",
      `🔗 [Dashboard](https://${appUrl}/mpf-care/health)`,
    ].join("\n"),
    color: overallColor,
  });

  return NextResponse.json({
    ok: true,
    status: hasFailures ? "failures" : hasWarnings ? "warnings" : "healthy",
  });
}
