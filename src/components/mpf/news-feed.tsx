"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { MpfNews, NewsRegion, NewsCategory } from "@/lib/mpf/types";

const REGIONS: { label: string; value: NewsRegion | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Global", value: "global" },
  { label: "Asia", value: "asia" },
  { label: "Hong Kong", value: "hk" },
  { label: "China", value: "china" },
];

const CATEGORIES: { label: string; value: NewsCategory | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Markets", value: "markets" },
  { label: "Geopolitical", value: "geopolitical" },
  { label: "Policy", value: "policy" },
  { label: "Macro", value: "macro" },
];

export function NewsFeed({ news }: { news: MpfNews[] }) {
  const [region, setRegion] = useState<NewsRegion | "all">("all");
  const [category, setCategory] = useState<NewsCategory | "all">("all");

  const filtered = news.filter((n) => {
    if (region !== "all" && n.region !== region) return false;
    if (category !== "all" && n.category !== category) return false;
    return true;
  });

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap gap-3 sm:gap-6 mb-8">
        <FilterGroup label="Region" items={REGIONS} value={region} onChange={setRegion} />
        <FilterGroup label="Category" items={CATEGORIES} value={category} onChange={setCategory} />
      </div>

      {/* Results */}
      {filtered.length === 0 ? (
        <p className="text-sm text-zinc-300">No news matches your filters.</p>
      ) : (
        <ol className="space-y-0 divide-y divide-zinc-800/60">
          {filtered.map((n) => (
            <li key={n.id} className="py-4 first:pt-0">
              <div className="flex items-start justify-between gap-2 sm:gap-4">
                <div className="min-w-0">
                  <a
                    href={n.url || "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[14px] text-zinc-300 hover:text-zinc-100 transition-colors leading-relaxed"
                  >
                    {n.headline}
                  </a>
                  {n.summary && (
                    <p className="text-[12px] text-zinc-300 mt-1 line-clamp-2">{n.summary}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    <span className="text-[10px] font-mono text-zinc-400">{n.source}</span>
                    <span className="text-[10px] font-mono text-zinc-500">|</span>
                    <span className="text-[10px] font-mono text-zinc-400">
                      {new Date(n.published_at).toLocaleDateString("en-HK")}
                    </span>
                    <span className={`text-[10px] font-mono ${
                      n.sentiment === "positive" ? "text-emerald-500" :
                      n.sentiment === "negative" ? "text-red-500" : "text-zinc-400"
                    }`}>
                      {n.sentiment}
                    </span>
                    {n.impact_tags.map((tag) => (
                      <span key={tag} className="text-[10px] font-mono text-zinc-300 bg-zinc-800/60 px-1.5 py-0.5 rounded">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
                {n.is_high_impact && (
                  <span className="text-[10px] font-mono text-amber-500 whitespace-nowrap shrink-0">
                    HIGH IMPACT
                  </span>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function FilterGroup<T extends string>({
  label,
  items,
  value,
  onChange,
}: {
  label: string;
  items: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <span className="text-[10px] font-mono text-zinc-400 block mb-1.5">{label}</span>
      <div className="flex gap-0.5" role="tablist" aria-label={`Filter by ${label}`}>
        {items.map((item) => (
          <button
            key={item.value}
            role="tab"
            aria-selected={value === item.value}
            onClick={() => onChange(item.value)}
            className={cn(
              "text-[11px] font-mono px-2.5 py-2 rounded-md transition-colors cursor-pointer",
              value === item.value
                ? "bg-zinc-800 text-zinc-200"
                : "text-zinc-400 hover:text-zinc-200"
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
