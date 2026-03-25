// src/components/mpf/model-performance.tsx
import type { RebalanceScore } from "@/lib/mpf/types";
import { ModelPerformanceDetails } from "./model-performance-details";

function computeWinRate(scores: RebalanceScore[]): number | null {
  const scored = scores.filter(
    (s) => s.reasoning_quality === "sound" || s.reasoning_quality === "lucky"
  );
  if (scores.length === 0) return null;
  return (scored.length / scores.length) * 100;
}

function computeStreak(scores: RebalanceScore[]): {
  type: "correct" | "incorrect";
  count: number;
} | null {
  if (scores.length === 0) return null;
  // Scores are already ordered most-recent-first
  const isWin = (s: RebalanceScore) =>
    s.reasoning_quality === "sound" || s.reasoning_quality === "lucky";
  const firstIsWin = isWin(scores[0]);
  let count = 0;
  for (const s of scores) {
    if (isWin(s) === firstIsWin) {
      count++;
    } else {
      break;
    }
  }
  return { type: firstIsWin ? "correct" : "incorrect", count };
}

function winRateColor(rate: number): string {
  if (rate > 60) return "text-emerald-400";
  if (rate >= 40) return "text-amber-400";
  return "text-red-400";
}

export function ModelPerformance({ scores }: { scores: RebalanceScore[] }) {
  if (scores.length === 0) {
    return (
      <section
        aria-labelledby="model-perf-heading"
        className="bg-zinc-900/50 border border-zinc-800/60 rounded-lg p-6"
      >
        <h2
          id="model-perf-heading"
          className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-300 mb-4"
        >
          Model Performance
        </h2>
        <p className="text-sm text-zinc-400">
          No scored decisions yet. The scoring cron runs weekly on Sundays.
        </p>
      </section>
    );
  }

  const winRate = computeWinRate(scores);
  const streak = computeStreak(scores);
  const firstScoredDate = scores[scores.length - 1]?.scored_at;
  const totalCount = scores.length;

  // Collect last 3 unique lessons
  const seenLessons = new Set<string>();
  const lessons: string[] = [];
  for (const s of scores) {
    for (const l of s.lessons || []) {
      if (!seenLessons.has(l) && lessons.length < 3) {
        seenLessons.add(l);
        lessons.push(l);
      }
    }
    if (lessons.length >= 3) break;
  }

  // Last 10 for timeline
  const last10 = scores.slice(0, 10);

  return (
    <section
      aria-labelledby="model-perf-heading"
      className="bg-zinc-900/50 border border-zinc-800/60 rounded-lg p-6"
    >
      <h2
        id="model-perf-heading"
        className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-300 mb-6"
      >
        Model Performance
      </h2>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
        {/* Win Rate */}
        <div>
          <p className="text-[10px] font-mono text-zinc-400 mb-1">Win Rate</p>
          <p
            className={`text-2xl font-mono tabular-nums font-semibold ${
              winRate !== null ? winRateColor(winRate) : "text-zinc-500"
            }`}
          >
            {winRate !== null ? `${winRate.toFixed(0)}%` : "—"}
          </p>
          <p className="text-[10px] font-mono text-zinc-500 mt-0.5">
            last {totalCount} scored
          </p>
        </div>

        {/* Since */}
        <div>
          <p className="text-[10px] font-mono text-zinc-400 mb-1">Since</p>
          <p className="text-lg font-mono tabular-nums text-zinc-200">
            {firstScoredDate
              ? new Date(firstScoredDate).toLocaleDateString("en-HK", {
                  month: "short",
                  day: "numeric",
                })
              : "—"}
          </p>
        </div>

        {/* Decisions scored */}
        <div>
          <p className="text-[10px] font-mono text-zinc-400 mb-1">
            Decisions Scored
          </p>
          <p className="text-2xl font-mono tabular-nums text-zinc-200">
            {totalCount}
          </p>
        </div>

        {/* Streak */}
        <div>
          <p className="text-[10px] font-mono text-zinc-400 mb-1">Streak</p>
          <p
            className={`text-2xl font-mono tabular-nums font-semibold ${
              streak?.type === "correct"
                ? "text-emerald-400"
                : "text-red-400"
            }`}
          >
            {streak ? `${streak.count}${streak.type === "correct" ? "W" : "L"}` : "—"}
          </p>
        </div>
      </div>

      {/* Expandable details (client component) */}
      <ModelPerformanceDetails
        last10={last10}
        lessons={lessons}
      />
    </section>
  );
}
