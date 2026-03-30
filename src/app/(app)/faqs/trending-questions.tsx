"use client";

import { useState, useEffect } from "react";

interface PopularQuery {
  query_text: string;
  count: number;
}

export function TrendingQuestions() {
  const [queries, setQueries] = useState<PopularQuery[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/popular-queries")
      .then((r) => { if (!r.ok) throw new Error("Failed to fetch queries"); return r.json(); })
      .then((data) => { if (Array.isArray(data)) setQueries(data); })
      .catch((err) => console.error("[trending-questions]", err))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return null;
  if (queries.length === 0) return null;

  return (
    <section aria-label="Trending Questions" className="mt-16">
      <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-gray-7 mb-6">
        Trending Questions
      </h2>
      <p className="text-gray-9 text-xs mb-4 -mt-4">
        Most frequently asked questions across all team conversations
      </p>

      <div className="space-y-2">
        {queries.map((q, i) => (
          <div
            key={`${q.query_text}-${i}`}
            className="flex items-center justify-between gap-4 px-5 py-3.5 rounded-xl border border-white/[0.04] bg-white/[0.015] hover:bg-white/[0.03] transition-colors"
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-[11px] font-bold text-gray-8 bg-white/[0.04] w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0">
                {i + 1}
              </span>
              <span className="text-[14px] text-[#f5f5f7] truncate">
                {q.query_text}
              </span>
            </div>
            <span className="text-[11px] font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full flex-shrink-0">
              {q.count}x asked
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
