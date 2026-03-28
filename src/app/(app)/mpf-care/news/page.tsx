import { createAdminClient } from "@/lib/supabase/admin";
import { NewsFeed } from "@/components/mpf/news-feed";
import type { MpfNews } from "@/lib/mpf/types";

export default async function MpfNewsPage() {
  const supabase = createAdminClient();

  const { data: news, error: newsErr } = await supabase
    .from("mpf_news")
    .select("*")
    .order("published_at", { ascending: false })
    .limit(100);

  if (newsErr) console.error("[news] news query error:", newsErr);

  return (
    <main className="max-w-[980px] mx-auto px-6 py-16 lg:py-24">
      <header className="mb-12">
        <div className="flex items-center gap-3 mb-2">
          <a href="/mpf-care" className="text-[11px] font-mono text-zinc-400 hover:text-zinc-200 transition-colors">
            ← MPF Care
          </a>
        </div>
        <h1 className="text-[clamp(1.5rem,3vw,2.25rem)] font-semibold tracking-[-0.03em] text-zinc-50 leading-[1.1]">
          News & Impact
        </h1>
        <p className="text-sm text-zinc-300 mt-2 font-mono">
          Financial news correlated with AIA MPF fund movements
        </p>
      </header>

      <NewsFeed news={(news || []) as MpfNews[]} />
    </main>
  );
}
