"use client";

import { useState, useEffect } from "react";
import type { FAQ } from "@/lib/types";

export function FAQManager() {
  const [faqs, setFaqs] = useState<FAQ[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQuestion, setEditQuestion] = useState("");
  const [editAnswer, setEditAnswer] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/faq")
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setFaqs(data); })
      .finally(() => setLoading(false));
  }, []);

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

  return (
    <div className="max-w-[980px] mx-auto px-6 py-16 lg:py-24">
      <div className="flex items-center justify-between mb-12">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight bg-gradient-to-b from-[#f5f5f7] to-white/70 bg-clip-text text-transparent">
            FAQ Manager
          </h1>
          <p className="text-gray-8 text-sm mt-2">
            {faqs.length} saved FAQ{faqs.length !== 1 ? "s" : ""} — edit questions, answers, or remove outdated entries
          </p>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-gray-8 py-12 text-center">Loading...</div>
      ) : faqs.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-gray-8 text-sm">No FAQs yet. Like a chat response to create one.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {faqs.map((faq) => (
            <div
              key={faq.id}
              className={`rounded-2xl border transition-all ${
                confirmDeleteId === faq.id
                  ? "border-red-500/30 bg-red-950/20"
                  : "border-white/[0.04] bg-white/[0.015]"
              }`}
            >
              {editingId === faq.id ? (
                /* Edit mode */
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
                /* View mode */
                <div className="p-5">
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <h3 className="text-[15px] font-semibold text-[#f5f5f7] leading-snug">{faq.question}</h3>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className="text-[11px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                        {faq.use_count}x used
                      </span>
                      <div className="flex gap-1">
                        <button
                          onClick={() => startEdit(faq)}
                          className="p-1.5 rounded-md text-gray-8 hover:text-white hover:bg-white/[0.06] transition-all"
                          title="Edit"
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
                              className="px-2 py-1 rounded-md text-[11px] font-bold bg-red-500/20 text-red-400 hover:bg-red-500/40 transition-colors"
                            >
                              Yes
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-2 py-1 rounded-md text-[11px] font-bold text-gray-8 hover:bg-white/[0.06] transition-colors"
                            >
                              No
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => setConfirmDeleteId(faq.id)}
                            className="p-1.5 rounded-md text-gray-8 hover:text-red-400 hover:bg-white/[0.06] transition-all"
                            title="Delete"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M3 6h18" /><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="text-[13px] text-gray-9 leading-relaxed line-clamp-3">
                    {faq.answer.substring(0, 300)}{faq.answer.length > 300 ? "..." : ""}
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {faq.keywords.map((kw) => (
                      <span key={kw} className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.04] text-gray-8">
                        {kw}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
