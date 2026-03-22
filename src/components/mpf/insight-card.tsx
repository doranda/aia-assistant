"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { MpfInsight } from "@/lib/mpf/types";

export function InsightCard({ insight }: { insight: MpfInsight }) {
  const [lang, setLang] = useState<"en" | "zh">("en");

  const content = lang === "zh" ? insight.content_zh : insight.content_en;
  const typeLabel = insight.type === "weekly" ? "Weekly Profile" :
                    insight.type === "alert" ? "Alert" : "On-Demand";

  return (
    <article className="border border-zinc-800/40 rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className={cn(
            "text-[10px] font-mono px-2 py-0.5 rounded",
            insight.type === "weekly" ? "bg-blue-950/50 text-blue-400" :
            insight.type === "alert" ? "bg-amber-950/50 text-amber-400" :
            "bg-zinc-800 text-zinc-400"
          )}>
            {typeLabel}
          </span>
          <span className="text-[11px] font-mono text-zinc-600">
            {new Date(insight.created_at).toLocaleDateString("en-HK", {
              year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
            })}
          </span>
        </div>

        {/* Language toggle */}
        <div className="flex gap-0.5" role="tablist" aria-label="Language">
          <button
            role="tab"
            aria-selected={lang === "en"}
            onClick={() => setLang("en")}
            className={cn(
              "text-[11px] font-mono px-2 py-0.5 rounded transition-colors cursor-pointer",
              lang === "en" ? "bg-zinc-800 text-zinc-200" : "text-zinc-600 hover:text-zinc-400"
            )}
          >
            EN
          </button>
          <button
            role="tab"
            aria-selected={lang === "zh"}
            onClick={() => setLang("zh")}
            className={cn(
              "text-[11px] font-mono px-2 py-0.5 rounded transition-colors cursor-pointer",
              lang === "zh" ? "bg-zinc-800 text-zinc-200" : "text-zinc-600 hover:text-zinc-400"
            )}
          >
            繁中
          </button>
        </div>
      </div>

      <div className="text-[13px] text-zinc-300 leading-relaxed whitespace-pre-wrap">
        {content || "Content not available in this language."}
      </div>

      {insight.trigger && (
        <div className="mt-4 text-[10px] font-mono text-zinc-700">
          Trigger: {insight.trigger}
        </div>
      )}
    </article>
  );
}
