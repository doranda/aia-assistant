import { createAdminClient } from "@/lib/supabase/admin";
import {
  getPipelineStatus,
  getDataFreshness,
  getMissingData,
  getOutliers,
  getNewsPipeline,
} from "@/lib/mpf/health";
import { PipelineStatus } from "./components/pipeline-status";
import { DataFreshness } from "./components/data-freshness";
import { MissingData } from "./components/missing-data";
import { OutlierAlerts } from "./components/outlier-alerts";
import { NewsPipeline } from "./components/news-pipeline";
import { Activity } from "lucide-react";

export default async function HealthDashboardPage() {
  const supabase = createAdminClient();

  const [pipeline, freshness, coverage, outliers, news] = await Promise.all([
    getPipelineStatus(supabase),
    getDataFreshness(supabase),
    getMissingData(supabase),
    getOutliers(supabase),
    getNewsPipeline(supabase),
  ]);

  return (
    <main className="max-w-[980px] mx-auto px-4 sm:px-6 py-8 lg:py-16 space-y-6">
      <header className="flex items-center gap-3">
        <Activity className="h-6 w-6 text-zinc-400" />
        <h1 className="text-2xl font-semibold tracking-tight">Pipeline Health</h1>
      </header>

      <section className="grid gap-6 md:grid-cols-2">
        <DataFreshness data={freshness} />
        <OutlierAlerts data={outliers} />
      </section>

      <section aria-label="Pipeline status">
        <PipelineStatus data={pipeline} />
      </section>
      <section aria-label="Data coverage">
        <MissingData data={coverage} />
      </section>
      <section aria-label="News pipeline">
        <NewsPipeline data={news} />
      </section>
    </main>
  );
}
