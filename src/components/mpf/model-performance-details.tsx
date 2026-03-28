"use client";

import { useState } from "react";
import type { RebalanceScore } from "@/lib/mpf/types";
import { ChevronDown } from "lucide-react";

const qualityBadge: Record<
  string,
  { label: string; className: string }
> = {
  sound: { label: "Sound", className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  lucky: { label: "Lucky", className: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  wrong: { label: "Wrong", className: "bg-red-500/15 text-red-400 border-red-500/30" },
  inconclusive: { label: "Inconclusive", className: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30" },
};

export function ModelPerformanceDetails({
  last10,
  lessons,
}: {
  last10: RebalanceScore[];
  lessons: string[];
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-400 hover:text-zinc-200 transition-colors py-2"
      >
        <ChevronDown
          className={`w-3.5 h-3.5 transition-transform ${
            expanded ? "rotate-180" : ""
          }`}
        />
        {expanded ? "Hide details" : "Show details"}
      </button>

      {expanded && (
        <div className="mt-4 space-y-6">
          {/* Timeline */}
          <div>
            <h3 className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider mb-3">
              Recent Decisions
            </h3>
            <ol className="space-y-0 divide-y divide-zinc-800/60">
              {last10.map((s) => {
                const badge = qualityBadge[s.reasoning_quality] || qualityBadge.inconclusive;
                const delta =
                  s.actual_return_pct != null && s.baseline_return_pct != null
                    ? s.actual_return_pct - s.baseline_return_pct
                    : null;

                return (
                  <li key={s.id} className="flex items-center justify-between py-2.5 first:pt-0 min-w-0">
                    <div className="flex items-center gap-3">
                      <time className="text-[10px] font-mono tabular-nums text-zinc-500 w-16 shrink-0">
                        {new Date(s.scored_at).toLocaleDateString("en-HK", {
                          month: "short",
                          day: "numeric",
                        })}
                      </time>
                      <span
                        className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${badge.className}`}
                      >
                        {badge.label}
                      </span>
                    </div>
                    {delta !== null && (
                      <span
                        className={`text-[11px] font-mono tabular-nums ${
                          delta >= 0 ? "text-emerald-400" : "text-red-400"
                        }`}
                      >
                        {delta >= 0 ? "+" : ""}
                        {delta.toFixed(2)}%
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>

          {/* Lessons learned */}
          {lessons.length > 0 && (
            <div>
              <h3 className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider mb-3">
                Lessons Learned
              </h3>
              <ul className="space-y-2">
                {lessons.map((l, i) => (
                  <li
                    key={i}
                    className="text-[12px] text-zinc-300 leading-relaxed pl-3 border-l-2 border-zinc-700"
                  >
                    {l}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
