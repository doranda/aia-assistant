"use client";

import { useState, useEffect, useMemo } from "react";
import type { FAQ } from "@/lib/types";

export function FAQManager() {
  const [faqs, setFaqs] = useState<FAQ[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQuestion, setEditQuestion] = useState("");
  const [editAnswer, setEditAnswer] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/faq")
      .then((r) => { if (!r.ok) throw new Error("Failed to fetch FAQs"); return r.json(); })
      .then((data) => { if (Array.isArray(data)) setFaqs(data); })
      .catch((err) => console.error("[faq-manager]", err))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return faqs;
    const q = search.toLowerCase();
    return faqs.filter(
      (f) =>
        f.question.toLowerCase().includes(q) ||
        f.answer.toLowerCase().includes(q) ||
        f.keywords.some((kw) => kw.toLowerCase().includes(q))
    );
  }, [faqs, search]);

  async function handleDelete(id: string) {
    const res = await fetch(`/api/faq/${id}`, { method: "DELETE" });
    if (res.ok) {
      setFaqs((prev) => prev.filter((f) => f.id !== id));
      setConfirmDeleteId(null);
    }
  }

  function startEdit(faq: FAQ) {
    setEditingId(faq.id);
    setEditQuestion(faq.question);
    setEditAnswer(faq.answer);
    setExpandedId(null);
  }

  async function saveEdit() {
    if (!editingId) return;
    const res = await fetch(`/api/faq/${editingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: editQuestion, answer: editAnswer }),
    });
    if (res.ok) {
      const updated = await res.json();
      setFaqs((prev) => prev.map((f) => (f.id === editingId ? { ...f, ...updated } : f)));
      setEditingId(null);
    }
  }

  if (loading) {
    return <div className="text-sm text-gray-8 py-12 text-center">Loading FAQs...</div>;
  }

  if (faqs.length === 0) {
    return (
      <div className="text-center py-16 rounded-2xl border border-white/[0.04] bg-white/[0.015]">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto text-gray-8 mb-4">
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><path d="M12 17h.01" /><circle cx="12" cy="12" r="10" />
        </svg>
        <p className="text-gray-8 text-sm">No saved FAQs yet</p>
        <p className="text-gray-9 text-xs mt-1">Click &quot;Save as FAQ&quot; on any chat response to add one</p>
      </div>
    );
  }

  return (
    <section aria-label="Saved FAQs">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-gray-7">
          Saved FAQs ({filtered.length})
        </h2>
        <div className="relative">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-8">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="text"
            placeholder="Search FAQs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-4 py-2 rounded-xl border border-white/[0.06] bg-white/[0.03] text-[13px] text-gray-11 placeholder:text-gray-8 focus:outline-none focus:border-ruby-9/50 transition-colors w-[240px]"
          />
        </div>
      </div>

      <div className="space-y-3">
        {filtered.map((faq) => (
          <div
            key={faq.id}
            className={`rounded-2xl border transition-all ${
              confirmDeleteId === faq.id
                ? "border-red-500/30 bg-red-950/20"
                : expandedId === faq.id
                ? "border-white/[0.08] bg-white/[0.025]"
                : "border-white/[0.04] bg-white/[0.015]"
            }`}
          >
            {editingId === faq.id ? (
              <div className="p-5 space-y-4">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-[0.12em] text-gray-7 block mb-1.5">Question</label>
                  <input
                    value={editQuestion}
                    onChange={(e) => setEditQuestion(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-white/[0.06] bg-white/[0.03] text-[14px] text-gray-11 focus:outline-none focus:border-ruby-9/50 transition-colors"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-[0.12em] text-gray-7 block mb-1.5">Answer</label>
                  <textarea
                    value={editAnswer}
                    onChange={(e) => setEditAnswer(e.target.value)}
                    rows={8}
                    className="w-full px-4 py-3 rounded-xl border border-white/[0.06] bg-white/[0.03] text-[14px] text-gray-11 leading-relaxed focus:outline-none focus:border-ruby-9/50 resize-none transition-colors"
                  />
                </div>
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => setEditingId(null)}
                    className="px-4 py-2 rounded-lg text-[12px] font-semibold text-gray-8 hover:text-white transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveEdit}
                    className="px-4 py-2 rounded-lg text-[12px] font-bold text-white bg-gradient-to-br from-ruby-9 to-ruby-10 hover:shadow-[0_0_20px_rgba(196,18,48,0.3)] transition-all"
                  >
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-5">
                <div className="flex items-start justify-between gap-4 mb-1">
                  <button
                    onClick={() => setExpandedId(expandedId === faq.id ? null : faq.id)}
                    className="text-left flex-1 group"
                  >
                    <h3 className="text-[15px] font-semibold text-[#f5f5f7] leading-snug group-hover:text-white transition-colors">
                      {faq.question}
                    </h3>
                  </button>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-[11px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                      {faq.use_count}x
                    </span>
                    <div className="flex gap-1">
                      <button
                        onClick={() => startEdit(faq)}
                        className="p-2.5 rounded-md text-gray-8 hover:text-white hover:bg-white/[0.06] transition-all min-h-[44px] min-w-[44px]"
                        aria-label="Edit"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                      {confirmDeleteId === faq.id ? (
                        <>
                          <button
                            onClick={() => handleDelete(faq.id)}
                            className="px-2 py-1 rounded-md text-[11px] font-bold bg-red-500/20 text-red-400 hover:bg-red-500/40 transition-colors min-h-[44px]"
                          >
                            Yes
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="px-2 py-1 rounded-md text-[11px] font-bold text-gray-8 hover:bg-white/[0.06] transition-colors min-h-[44px]"
                          >
                            No
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteId(faq.id)}
                          className="p-2.5 rounded-md text-gray-8 hover:text-red-400 hover:bg-white/[0.06] transition-all min-h-[44px] min-w-[44px]"
                          aria-label="Delete"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 6h18" /><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {expandedId === faq.id ? (
                  <div className="mt-3 pt-3 border-t border-white/[0.04]">
                    <div className="text-[13px] text-gray-9 leading-relaxed whitespace-pre-wrap">
                      {faq.answer}
                    </div>
                    {faq.sources && faq.sources.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {faq.sources.map((src, i) => (
                          <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-ruby-500/10 text-ruby-400">
                            {src.document_title}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-[12px] text-gray-9 mt-1 line-clamp-1">
                    {faq.answer.substring(0, 120)}{faq.answer.length > 120 ? "..." : ""}
                  </p>
                )}

                <div className="flex flex-wrap gap-1.5 mt-3">
                  {faq.keywords.map((kw) => (
                    <button
                      type="button"
                      key={kw}
                      className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.04] text-gray-8 cursor-pointer hover:bg-white/[0.08] transition-colors"
                      onClick={() => setSearch(kw)}
                    >
                      {kw}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
