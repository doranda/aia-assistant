import { createAdminClient } from "@/lib/supabase/admin";
import { generateInsight } from "./insights";

export async function processPendingAlerts(): Promise<number> {
  const supabase = createAdminClient();

  const { data: pending } = await supabase
    .from("mpf_insights")
    .select("id")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(3);

  if (!pending?.length) return 0;

  let processed = 0;
  for (const insight of pending) {
    try {
      await generateInsight(insight.id);
      processed++;
    } catch {
      continue;
    }
  }

  return processed;
}
