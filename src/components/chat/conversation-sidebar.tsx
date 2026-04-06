"use client";

import { useState } from "react";
import type { Conversation } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/lib/i18n";

interface ConversationSidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

export function ConversationSidebar({ conversations, activeId, onSelect, onNew, onDelete }: ConversationSidebarProps) {
  const { t } = useLanguage();
  const [confirmId, setConfirmId] = useState<string | null>(null);

  return (
    <aside className="hidden lg:block w-[260px] flex-shrink-0 border-r border-white/[0.03] bg-gradient-to-b from-white/[0.02] to-white/[0.005] shadow-[1px_0_20px_rgba(0,0,0,0.3)] overflow-y-auto">
      <div className="p-4">
        <button onClick={onNew} className="w-full py-2.5 rounded-full text-[13px] font-bold text-white bg-gradient-to-br from-ruby-9 to-ruby-10 shadow-[0_0_20px_rgba(196,18,48,0.2)] hover:shadow-[0_0_30px_rgba(196,18,48,0.35)] transition-all">
          {t("chat.newChat")}
        </button>
      </div>
      <div className="px-4">
        <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-gray-8 mb-3">{t("chat.conversations")}</div>
        {conversations.length === 0 && (
          <p className="text-xs text-gray-7 px-4 py-8 text-center">{t("chat.noConversations")}</p>
        )}
        {conversations.map((conv) => (
          <div
            role="button"
            tabIndex={0}
            key={conv.id}
            className={cn(
              "group relative w-full text-left px-4 py-3.5 rounded-xl mb-1.5 border border-transparent border-l-2 transition-all cursor-pointer",
              confirmId === conv.id
                ? "bg-red-950/30 border-red-500/30 border-l-red-500"
                : activeId === conv.id
                  ? "bg-white/[0.04] border-white/[0.06] border-l-ruby-9"
                  : "border-l-transparent hover:bg-white/[0.03] hover:border-l-ruby-9/30"
            )}
            onClick={() => { setConfirmId(null); onSelect(conv.id); }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setConfirmId(null); onSelect(conv.id); } }}
          >
            {confirmId === conv.id ? (
              <>
                <div className="text-[13px] font-medium text-red-400 truncate pr-16">{t("chat.deleteChat")}</div>
                <div className="text-[11px] text-red-400/60 mt-1">{conv.title}</div>
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
                  <button
                    onClick={(e) => { e.stopPropagation(); onDelete(conv.id); setConfirmId(null); }}
                    className="px-2 py-1 rounded-md text-[11px] font-bold bg-red-500/20 text-red-400 hover:bg-red-500/40 transition-colors"
                  >
                    {t("chat.yes")}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setConfirmId(null); }}
                    className="px-2 py-1 rounded-md text-[11px] font-bold text-gray-8 hover:bg-white/[0.06] transition-colors"
                  >
                    {t("chat.no")}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="text-[13px] font-medium text-gray-11 truncate pr-6">{conv.title}</div>
                <div className="text-[11px] text-gray-8 mt-1">{new Date(conv.updated_at).toLocaleDateString()}</div>
                <button
                  onClick={(e) => { e.stopPropagation(); setConfirmId(conv.id); }}
                  className="absolute right-1 top-1/2 -translate-y-1/2 p-2.5 rounded-md opacity-0 group-hover:opacity-100 hover:bg-white/[0.08] text-gray-8 hover:text-red-400 transition-all"
                  aria-label={t("chat.deleteConversation")}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18" /><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                  </svg>
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </aside>
  );
}
