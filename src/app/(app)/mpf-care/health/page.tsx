import { createClient } from "@/lib/supabase/server";
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
  const supabase = await createClient();

  const [pipeline, freshness, coverage, outliers, news] = await Promise.all([
    getPipelineStatus(supabase),
    getDataFreshness(supabase),
    getMissingData(supabase),
    getOutliers(supabase),
    getNewsPipeline(supabase),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Activity className="h-6 w-6 text-zinc-400" />
        <h1 className="text-2xl font-semibold tracking-tight">Pipeline Health</h1>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <DataFreshness data={freshness} />
        <OutlierAlerts data={outliers} />
      </div>

      <PipelineStatus data={pipeline} />
      <MissingData data={coverage} />
      <NewsPipeline data={news} />
    </div>
  );
}
