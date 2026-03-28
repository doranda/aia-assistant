"use client";

import { cn } from "@/lib/utils";
import { useState } from "react";
import type { FundMetrics, MetricPeriod } from "@/lib/mpf/types";

interface RiskMetricsProps {
  metrics: Record<MetricPeriod, FundMetrics | null>;
}

function metricColor(val: number | null, type: "ratio" | "drawdown" | "return" | "neutral"): string {
  if (val === null) return "text-zinc-500";
  switch (type) {
    case "ratio":
      if (val > 1) return "text-emerald-400";
      if (val > 0) return "text-zinc-200";
      return "text-red-400";
    case "drawdown":
      if (val > -0.05) return "text-emerald-400";
      if (val > -0.15) return "text-amber-400";
      return "text-red-400";
    case "return":
      if (val > 0) return "text-emerald-400";
      if (val < 0) return "text-red-400";
      return "text-zinc-300";
    default:
      return "text-zinc-300";
  }
}

export function RiskMetrics({ metrics }: RiskMetricsProps) {
  const [period, setPeriod] = useState<MetricPeriod>("3y");
  const m = metrics[period];

  const periods: { key: MetricPeriod; label: string }[] = [
    { key: "1y", label: "1Y" },
    { key: "3y", label: "3Y" },
    { key: "5y", label: "5Y" },
    { key: "since_launch", label: "All" },
  ];

  const cards = [
    { label: "Sortino", value: m?.sortino_ratio, format: (v: number) => v.toFixed(2), type: "ratio" as const, tooltip: "Return per unit of downside risk. Higher = better downside protection." },
    { label: "Sharpe", value: m?.sharpe_ratio, format: (v: number) => v.toFixed(2), type: "ratio" as const, tooltip: "Return per unit of total risk. >1 good, >1.5 excellent." },
    { label: "Max Drawdown", value: m?.max_drawdown_pct, format: (v: number) => `${(v * 100).toFixed(1)}%`, type: "drawdown" as const, tooltip: "Worst peak-to-trough decline. Closer to 0% = less downside risk." },
    { label: "Volatility", value: m?.annualized_volatility_pct, format: (v: number) => `${(v * 100).toFixed(1)}%`, type: "neutral" as const, tooltip: "Annualized standard deviation of daily returns." },
    { label: "FER", value: m?.expense_ratio_pct, format: (v: number) => `${v.toFixed(2)}%`, type: "neutral" as const, tooltip: "Fund Expense Ratio — annual fee. Lower = better." },
  ];

  return (
    <section aria-labelledby="risk-metrics-heading">
      <div className="flex items-center justify-between mb-4">
        <h2 id="risk-metrics-heading" className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-300">
          Risk Metrics
        </h2>
        <div className="flex items-center gap-1">
          {periods.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={cn(
                "text-[10px] font-mono px-3 py-2 rounded transition-colors",
                p.key === period ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {!m ? (
        <p className="text-sm text-zinc-400">Insufficient data for this period.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {cards.map((card) => (
            <div key={card.label} className="bg-zinc-900/50 border border-zinc-800/60 rounded-lg p-3" title={card.tooltip}>
              <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 mb-1">{card.label}</div>
              <div className={cn("text-lg font-mono font-semibold tabular-nums", metricColor(card.value ?? null, card.type))}>
                {card.value !== null && card.value !== undefined ? card.format(card.value) : "\u2014"}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
