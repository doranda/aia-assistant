// src/app/(app)/ilas-track/page.tsx
// ILAS Track — Investment-Linked Assurance Scheme fund tracking
// Phase 1+2 complete: 142 funds seeded, prices scraped. UI coming next.

import { createAdminClient } from "@/lib/supabase/admin";
import { BarChart3 } from "lucide-react";

export default async function IlasTrackPage() {
  const supabase = createAdminClient();

  const { count: fundCount } = await supabase
    .from("ilas_funds")
    .select("*", { count: "exact", head: true })
    .eq("is_active", true);

  const { count: accCount } = await supabase
    .from("ilas_funds")
    .select("*", { count: "exact", head: true })
    .eq("is_distribution", false);

  const { count: disCount } = await supabase
    .from("ilas_funds")
    .select("*", { count: "exact", head: true })
    .eq("is_distribution", true);

  const { count: priceCount } = await supabase
    .from("ilas_prices")
    .select("*", { count: "exact", head: true });

  return (
    <main className="max-w-[980px] mx-auto px-6 py-8 lg:py-16 xl:py-24">
      <header className="mb-8 lg:mb-16">
        <h1 className="text-[clamp(2rem,4vw,3rem)] font-semibold tracking-[-0.03em] text-zinc-50 leading-[1.1]">
          ILAS Track
        </h1>
        <p className="text-sm text-zinc-300 mt-2 font-mono">
          AIA Investment-Linked Assurance Scheme — Fund tracking & insights
        </p>
      </header>

      <section className="border border-zinc-800/60 rounded-lg p-4 sm:p-6 mb-8">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="w-4 h-4 text-zinc-400" />
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-300">
            System Status
          </h2>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-lg p-4">
            <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 mb-1">Total Funds</div>
            <div className="text-lg sm:text-xl font-mono font-semibold tabular-nums text-zinc-100">
              {fundCount || 0}
            </div>
          </div>
          <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-lg p-4">
            <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 mb-1">Accumulation</div>
            <div className="text-lg sm:text-xl font-mono font-semibold tabular-nums text-emerald-400">
              {accCount || 0}
            </div>
          </div>
          <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-lg p-4">
            <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 mb-1">Distribution</div>
            <div className="text-lg sm:text-xl font-mono font-semibold tabular-nums text-amber-400">
              {disCount || 0}
            </div>
          </div>
          <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-lg p-4">
            <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 mb-1">Price Records</div>
            <div className="text-lg sm:text-xl font-mono font-semibold tabular-nums text-zinc-100">
              {priceCount || 0}
            </div>
          </div>
        </div>
      </section>

      <p className="text-[13px] text-zinc-400 leading-relaxed">
        ILAS Track is under construction. Fund data pipeline is live — 142 funds across 16 asset classes
        from 29 fund houses. Rebalancer, portfolio tracking, and full dashboard coming soon.
      </p>
    </main>
  );
}
