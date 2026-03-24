import type { PipelineRunStatus } from "@/lib/mpf/health";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// NOTE: scraper_name values must match what cron handlers write to scraper_runs.
// news cron writes "news_pipeline", weekly cron writes "weekly_insight" (added in Task 5)
const SCRAPERS = ["fund_prices", "news_pipeline", "weekly_insight"] as const;
const SCRAPER_LABELS: Record<string, string> = {
  fund_prices: "Prices",
  news_pipeline: "News",
  weekly_insight: "Insights",
};

function StatusDot({ status }: { status: "success" | "failed" | "running" | "none" }) {
  const colors = {
    success: "bg-emerald-500",
    failed: "bg-red-500",
    running: "bg-yellow-500 animate-pulse",
    none: "bg-zinc-700",
  };
  return <div className={`h-4 w-4 rounded-sm ${colors[status]}`} title={status} />;
}

export function PipelineStatus({ data }: { data: PipelineRunStatus[] }) {
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().split("T")[0]);
  }

  const statusMap = new Map<string, Map<string, PipelineRunStatus>>();
  for (const run of data) {
    if (!statusMap.has(run.scraper_name)) statusMap.set(run.scraper_name, new Map());
    const existing = statusMap.get(run.scraper_name)!.get(run.date);
    if (!existing || new Date(run.date) > new Date(existing.date)) {
      statusMap.get(run.scraper_name)!.set(run.date, run);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Pipeline Status (7 days)</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="grid grid-cols-[100px_repeat(7,1fr)] gap-2 text-xs text-zinc-500">
            <div />
            {days.map((d) => (
              <div key={d} className="text-center">
                {new Date(d).toLocaleDateString("en-US", { weekday: "short", day: "numeric" })}
              </div>
            ))}
          </div>
          {SCRAPERS.map((scraper) => (
            <div key={scraper} className="grid grid-cols-[100px_repeat(7,1fr)] gap-2 items-center">
              <div className="text-sm text-zinc-400">{SCRAPER_LABELS[scraper] || scraper}</div>
              {days.map((day) => {
                const run = statusMap.get(scraper)?.get(day);
                return (
                  <div key={day} className="flex justify-center">
                    <StatusDot status={run?.status || "none"} />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
