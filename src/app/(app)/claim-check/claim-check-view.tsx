"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AttachmentZone } from "@/components/claim-check/attachment-zone";

const CLAIM_TYPES = [
  "Medical / Hospitalization",
  "Trip Cancellation",
  "Lost Baggage",
  "Personal Accident",
  "Travel Delay",
  "Personal Liability",
  "Other",
];

interface CheckResult {
  answer: string;
  sources: { document_title: string; page_number: number }[];
  isFAQ: boolean;
}

export function ClaimCheckView() {
  const [claimType, setClaimType] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [language, setLanguage] = useState<"auto" | "en" | "zh">("auto");
  const [files, setFiles] = useState<File[]>([]);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState("");

  async function handleCheck() {
    if (!claimType || !description.trim()) return;
    setLoading(true);
    setResult(null);
    setLoadingStatus(files.length > 0 ? "Scanning attachments..." : "Checking eligibility...");

    const formData = new FormData();
    formData.append("claimType", claimType);
    formData.append("amount", amount || "not specified");
    formData.append("description", description);
    formData.append("language", language);
    for (const file of files) {
      formData.append("files", file);
    }

    try {
      setLoadingStatus("Checking eligibility...");
      const res = await fetch("/api/claim-check", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        setResult({ answer: "Failed to check. Please try again.", sources: [], isFAQ: false });
        setLoading(false);
        return;
      }

      let citations: { document_title: string; page_number: number }[] = [];
      const citationsHeader = res.headers.get("X-Citations");
      if (citationsHeader) {
        try { citations = JSON.parse(citationsHeader); } catch {}
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      let isFAQ = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        const lines = text.split("\n").filter((l) => l.startsWith("data: "));
        for (const line of lines) {
          const data = line.replace("data: ", "");
          if (data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.faq) isFAQ = true;
            if (parsed.content) accumulated += parsed.content;
          } catch {}
        }
      }

      setResult({ answer: accumulated, sources: citations, isFAQ });
    } catch {
      setResult({ answer: "Failed to connect. Please try again.", sources: [], isFAQ: false });
    }

    setLoading(false);
  }

  return (
    <main className="max-w-[720px] mx-auto px-6 py-16 lg:py-24">
      <header className="mb-12">
        <h1 className="text-[clamp(2rem,4vw,3rem)] font-semibold tracking-[-0.03em] text-zinc-50 leading-[1.1]">
          Claim Check
        </h1>
        <p className="text-sm text-zinc-500 mt-2 font-mono">Check eligibility against policy documents</p>
      </header>

      <div className="space-y-6">
        {/* Claim type */}
        <div>
          <label className="text-[11px] font-bold uppercase tracking-[0.12em] text-gray-7 block mb-2">
            Claim Type
          </label>
          <div className="flex flex-wrap gap-2">
            {CLAIM_TYPES.map((type) => (
              <button
                key={type}
                onClick={() => setClaimType(type)}
                className={`px-3.5 py-2 text-[13px] rounded-lg border transition-all ${
                  claimType === type
                    ? "border-ruby-9 bg-ruby-9/10 text-ruby-11 font-semibold"
                    : "border-white/[0.06] bg-white/[0.03] text-gray-9 hover:bg-white/[0.06] hover:text-white"
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        {/* Amount */}
        <div>
          <label className="text-[11px] font-bold uppercase tracking-[0.12em] text-gray-7 block mb-2">
            Claim Amount (HKD) — optional
          </label>
          <input
            type="text"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g. 50,000"
            className="w-full max-w-[240px] px-4 py-2.5 rounded-xl border border-white/[0.06] bg-white/[0.03] text-[14px] text-gray-11 placeholder:text-gray-7 focus:outline-none focus:border-ruby-9/50 transition-colors"
          />
        </div>

        {/* Description */}
        <div>
          <label className="text-[11px] font-bold uppercase tracking-[0.12em] text-gray-7 block mb-2">
            Describe the Situation
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Client was hospitalized for 3 days in Tokyo during a single-trip covered journey. Total bill HKD 85,000 including surgery."
            rows={4}
            className="w-full px-4 py-3 rounded-xl border border-white/[0.06] bg-white/[0.03] text-[14px] text-gray-11 placeholder:text-gray-7 leading-relaxed focus:outline-none focus:border-ruby-9/50 resize-none transition-colors"
          />
        </div>

        {/* Attachments */}
        <AttachmentZone onFilesChange={setFiles} />

        {/* Language + Submit */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-gray-7">Reply in</span>
            {(["auto", "en", "zh"] as const).map((lang) => (
              <button
                key={lang}
                onClick={() => setLanguage(lang)}
                className={`text-[11px] px-2.5 py-1 rounded-full transition-all ${
                  language === lang
                    ? "bg-white/[0.08] text-[#f5f5f7] font-semibold"
                    : "text-gray-8 hover:text-gray-11"
                }`}
              >
                {lang === "auto" ? "Auto" : lang === "en" ? "EN" : "中文"}
              </button>
            ))}
          </div>
          <button
            onClick={handleCheck}
            disabled={loading || !claimType || !description.trim()}
            className="px-6 py-2.5 rounded-full text-[13px] font-bold text-white bg-gradient-to-br from-ruby-9 to-ruby-10 shadow-[0_0_20px_rgba(196,18,48,0.2)] hover:shadow-[0_0_30px_rgba(196,18,48,0.35)] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            {loading ? loadingStatus : "Check Eligibility"}
          </button>
        </div>
      </div>

      {/* Result */}
      {result && (
        <div className="mt-12 px-5 py-6 rounded-2xl border border-white/[0.04] bg-white/[0.015]">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-gray-7">
              Assessment
            </span>
            {result.isFAQ && (
              <span className="text-[10px] font-bold uppercase tracking-[0.08em] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                FAQ — Instant
              </span>
            )}
          </div>
          <div className="prose prose-invert prose-sm max-w-none text-gray-11 prose-headings:text-[#f5f5f7] prose-headings:font-bold prose-h3:text-[14px] prose-h3:mt-6 prose-h3:mb-2 prose-p:text-[14px] prose-p:leading-relaxed prose-p:mb-2 prose-li:text-[14px] prose-strong:text-[#f5f5f7] prose-ul:my-2 prose-ol:my-2 prose-hr:border-white/[0.06] prose-table:text-[13px] prose-th:px-3 prose-th:py-2 prose-th:border-b prose-th:border-white/[0.1] prose-td:px-3 prose-td:py-2 prose-td:border-b prose-td:border-white/[0.04]">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{result.answer}</ReactMarkdown>
          </div>
          {result.sources.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-5 pt-4 border-t border-white/[0.04]">
              <span className="w-full text-[10px] font-bold uppercase tracking-[0.1em] text-gray-7 mb-1">Sources</span>
              {result.sources.map((s, i) => (
                <span key={i} className="text-[11px] px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/[0.06] text-gray-9">
                  {s.document_title}, p.{s.page_number}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </main>
  );
}
