import { createAdminClient } from "@/lib/supabase/admin";
import { generateInsight } from "./insights";

export async function processPendingAlerts(): Promise<number> {
  const supabase = createAdminClient();

  const { data: pending, error } = await supabase
    .from("mpf_insights")
    .select("id")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(3);

  if (error) console.error("[alerts] pending insights query error:", error);
  if (!pending?.length) return 0;

  let processed = 0;
  for (const insight of pending) {
    try {
      await generateInsight(insight.id);
      processed++;
    } catch (e) {
      console.error("[alerts] generateInsight failed for", insight.id, e);
      continue;
    }
  }

  return processed;
}
