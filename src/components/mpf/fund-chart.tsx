"use client";

import { useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";

interface PricePoint {
  date: string;
  nav: number;
}

const PERIODS = [
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "1Y", days: 365 },
  { label: "5Y", days: 1825 },
] as const;

export function FundChart({ prices }: { prices: PricePoint[] }) {
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["label"]>("1M");

  const days = PERIODS.find((p) => p.label === period)?.days || 30;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const filtered = prices.filter((p) => p.date >= cutoff);

  return (
    <div>
      <div className="flex gap-1 mb-4" role="tablist">
        {PERIODS.map((p) => (
          <button
            key={p.label}
            role="tab"
            aria-selected={period === p.label}
            onClick={() => setPeriod(p.label)}
            className={cn(
              "text-[11px] font-mono px-3 py-2 rounded-md transition-colors cursor-pointer",
              period === p.label
                ? "bg-zinc-800 text-zinc-200"
                : "text-zinc-400 hover:text-zinc-200"
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={filtered}>
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: "#71717a" }}
            tickFormatter={(d: string) => d.slice(5)} // MM-DD
          />
          <YAxis
            tick={{ fontSize: 10, fill: "#71717a" }}
            domain={["auto", "auto"]}
            width={60}
          />
          <Tooltip
            contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: "6px", fontSize: "12px" }}
            labelStyle={{ color: "#a1a1aa" }}
            itemStyle={{ color: "#e4e4e7" }}
          />
          <Line
            type="monotone"
            dataKey="nav"
            stroke="#D71920"
            strokeWidth={1.5}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
