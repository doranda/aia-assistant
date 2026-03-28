import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canGenerateInsight } from "@/lib/permissions";
import { InsightCard } from "@/components/mpf/insight-card";
import { DisclaimerBanner } from "@/components/mpf/disclaimer-banner";
import { GenerateInsightButton } from "./generate-button";
import type { MpfInsight } from "@/lib/mpf/types";
import type { UserRole } from "@/lib/types";

export default async function MpfInsightsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const adminClient = createAdminClient();

  const { data: profile, error: profileErr } = await adminClient
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profileErr) console.error("[insights] profile query error:", profileErr);

  const role = (profile?.role || "agent") as UserRole;
  const canGenerate = canGenerateInsight(role);

  const { data: insights, error: insightsErr } = await adminClient
    .from("mpf_insights")
    .select("*")
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(20);

  if (insightsErr) console.error("[insights] insights query error:", insightsErr);

  return (
    <main className="max-w-[980px] mx-auto px-6 py-16 lg:py-24">
      <header className="mb-12">
        <div className="flex items-center gap-3 mb-2">
          <a href="/mpf-care" className="text-[11px] font-mono text-zinc-400 hover:text-zinc-200 transition-colors">
            ← MPF Care
          </a>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[clamp(1.5rem,3vw,2.25rem)] font-semibold tracking-[-0.03em] text-zinc-50 leading-[1.1]">
              Rebalancing Insights
            </h1>
            <p className="text-sm text-zinc-300 mt-2 font-mono">
              AI-generated AIA MPF Care Profiles
            </p>
          </div>
          {canGenerate && <GenerateInsightButton />}
        </div>
      </header>

      <DisclaimerBanner />

      <div className="mt-8 space-y-6">
        {(!insights || insights.length === 0) ? (
          <p className="text-sm text-zinc-300 py-8">No insights generated yet. {canGenerate ? "Click \"Generate Fresh Insight\" to create one." : ""}</p>
        ) : (
          (insights as MpfInsight[]).map((insight) => (
            <InsightCard key={insight.id} insight={insight} />
          ))
        )}
      </div>
    </main>
  );
}
