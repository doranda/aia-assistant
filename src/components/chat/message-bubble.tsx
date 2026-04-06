"use client";

import { useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { MessageSource } from "@/lib/types";
import { ExternalLink, Loader2 } from "lucide-react";
import { useLanguage } from "@/lib/i18n";

interface MessageBubbleProps {
  role: "user" | "assistant";
  content: string;
  sources?: MessageSource[] | null;
  isStreaming?: boolean;
  isFAQ?: boolean;
  userQuestion?: string;
  onSaveAsFAQ?: (question: string, answer: string, sources: MessageSource[] | null) => void;
}

export function MessageBubble({ role, content, sources, isStreaming, isFAQ, userQuestion, onSaveAsFAQ }: MessageBubbleProps) {
  const { t } = useLanguage();
  const [saved, setSaved] = useState(false);
  const [sourcesExpanded, setSourcesExpanded] = useState(false);
  const [loadingSource, setLoadingSource] = useState<string | null>(null);

  const handleSourceClick = useCallback(async (source: MessageSource) => {
    if (!source.file_path) return;
    const key = `${source.document_id}-${source.page_number}`;
    setLoadingSource(key);
    try {
      const res = await fetch(`/api/documents/view?path=${encodeURIComponent(source.file_path)}`);
      if (!res.ok) return;
      const { url } = await res.json();
      if (url) window.open(url, "_blank", "noopener");
    } catch {
      // silent — button just stops loading
    } finally {
      setLoadingSource(null);
    }
  }, []);

  function handleLike() {
    if (!onSaveAsFAQ || !userQuestion || saved) return;
    onSaveAsFAQ(userQuestion, content, sources || null);
    setSaved(true);
  }

  if (role === "user") {
    return (
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#52525B]">
            {t("chat.you")}
          </span>
        </div>
        <p className="text-[15px] leading-[1.65] text-[#A1A1AA]">
          {content}
        </p>
      </div>
    );
  }

  return (
    <div className="mb-8">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#D71920]">
          {t("chat.aiaKnowledge")}
        </span>
        {isFAQ && (
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] px-2 py-0.5 rounded-[4px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            {t("chat.faqInstant")}
          </span>
        )}
      </div>

      {/* Document-thread layout: red left border on AI turns */}
      <div className="pl-4 border-l-2 border-[#D71920]/60">
        <div className="prose prose-invert prose-sm max-w-none
          text-[#A1A1AA]
          prose-headings:text-[#FAFAFA] prose-headings:font-semibold prose-headings:tracking-tight
          prose-h3:text-[14px] prose-h3:mt-5 prose-h3:mb-2
          prose-p:text-[15px] prose-p:leading-[1.65] prose-p:mb-3 prose-p:text-[#A1A1AA]
          prose-li:text-[15px] prose-li:leading-[1.65] prose-li:text-[#A1A1AA]
          prose-strong:text-[#FAFAFA] prose-strong:font-semibold
          prose-ul:my-3 prose-ol:my-3
          prose-hr:border-white/[0.08] prose-hr:my-4
          prose-blockquote:border-white/[0.1] prose-blockquote:text-[#71717A] prose-blockquote:text-[13px]
          prose-table:text-[13px] prose-th:text-[#FAFAFA] prose-th:font-semibold prose-th:text-left
          prose-th:px-3 prose-th:py-2 prose-th:border-b prose-th:border-white/[0.1]
          prose-td:px-3 prose-td:py-2 prose-td:border-b prose-td:border-white/[0.06]
          prose-table:w-full prose-table:border-collapse
          prose-code:text-[13px] prose-code:font-mono prose-code:text-[#A1A1AA] prose-code:bg-white/[0.05] prose-code:px-1 prose-code:py-0.5 prose-code:rounded">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          {isStreaming && (
            <span className="inline-block w-1.5 h-4 bg-[#D71920] animate-pulse ml-0.5" />
          )}
        </div>

        {/* Source documents */}
        {sources && sources.length > 0 && (
          <div className="mt-4">
            <button
              onClick={() => setSourcesExpanded(!sourcesExpanded)}
              className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#52525B] hover:text-[#A1A1AA] transition-colors"
              aria-label={sourcesExpanded ? t("chat.hideSources") : t("chat.showSources")}
              aria-expanded={sourcesExpanded}
            >
              <span>{sources.length} {t("chat.sources")}{sources.length > 1 ? "s" : ""}</span>
              <svg
                width="10" height="10" viewBox="0 0 10 10" fill="currentColor"
                className={`transition-transform ${sourcesExpanded ? "rotate-180" : ""}`}
              >
                <path d="M5 6.5L1 2.5h8L5 6.5z" />
              </svg>
            </button>

            {sourcesExpanded && (
              <div className="mt-2 flex flex-col gap-1">
                {sources.map((source, i) => {
                  const key = `${source.document_id}-${source.page_number}`;
                  const isLoading = loadingSource === key;
                  const hasFile = !!source.file_path;
                  return (
                    <button
                      key={i}
                      onClick={() => hasFile && handleSourceClick(source)}
                      disabled={isLoading || !hasFile}
                      className={`flex items-start gap-3 px-3 py-2.5 rounded-[6px] bg-[#18181B] border border-white/[0.06] transition-all text-left w-full ${
                        hasFile
                          ? "hover:border-[#D71920]/30 hover:bg-[#D71920]/[0.04] cursor-pointer"
                          : "cursor-default"
                      }`}
                    >
                      <span className="shrink-0 mt-0.5 text-[11px] font-semibold text-[#D71920] font-mono">
                        [{i + 1}]
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] text-[#FAFAFA] leading-snug truncate">
                          {source.document_title}
                        </p>
                        <p className="text-[11px] font-mono text-[#52525B] mt-0.5">
                          p.{source.page_number}
                          {source.relevance_score != null && (
                            <span className="ml-2 text-[#D71920]/70">
                              {Math.round(source.relevance_score * 100)}% {t("chat.match")}
                            </span>
                          )}
                        </p>
                      </div>
                      {hasFile && (
                        <span className="shrink-0 mt-1 text-[#52525B]">
                          {isLoading ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <ExternalLink className="w-3.5 h-3.5" />
                          )}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Save as FAQ action */}
      {!isStreaming && onSaveAsFAQ && !isFAQ && (
        <div className="mt-3 pl-4">
          <button
            onClick={handleLike}
            disabled={saved}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] text-[12px] font-semibold transition-all ${
              saved
                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                : "text-[#52525B] border border-white/[0.06] hover:text-emerald-400 hover:border-emerald-500/20 hover:bg-emerald-500/5"
            }`}
          >
            {saved ? (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
                </svg>
                {t("chat.savedAsFaq")}
              </>
            ) : (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/>
                  <path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>
                </svg>
                {t("chat.saveAsFaq")}
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
