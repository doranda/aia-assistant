"use client";

import { useState } from "react";
import type { Conversation } from "@/lib/types";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

interface ConversationDrawerProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

export function ConversationDrawer({ conversations, activeId, onSelect, onNew, onDelete }: ConversationDrawerProps) {
  const [confirmId, setConfirmId] = useState<string | null>(null);

  return (
    <div className="lg:hidden flex items-center gap-2 mb-4">
      <Sheet>
        <SheetTrigger className="text-xs text-gray-9 font-semibold px-3 py-2.5 min-h-[44px] rounded-full border border-white/[0.06] hover:text-gray-12 transition-all">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="inline mr-1">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
          Chats
        </SheetTrigger>
        <SheetContent side="left" className="bg-gray-1 border-white/[0.06] w-[280px]">
          <SheetHeader>
            <SheetTitle className="text-gray-12">Conversations</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-1">
            <button onClick={onNew} className="w-full py-2.5 rounded-full text-[13px] font-bold text-white bg-gradient-to-br from-ruby-9 to-ruby-10 mb-4">
              + New chat
            </button>
            {conversations.map((conv) => (
              <button
                type="button"
                key={conv.id}
                className={cn(
                  "group relative w-full text-left px-3 py-3 rounded-lg transition-colors cursor-pointer bg-transparent appearance-none",
                  confirmId === conv.id
                    ? "bg-red-950/30 border-l-2 border-l-red-500"
                    : activeId === conv.id
                      ? "bg-white/[0.06] border-l-2 border-l-ruby-9"
                      : "hover:bg-white/[0.03]"
                )}
                onClick={() => { setConfirmId(null); onSelect(conv.id); }}
              >
                {confirmId === conv.id ? (
                  <>
                    <div className="text-sm text-red-400 truncate pr-16">Delete this chat?</div>
                    <div className="text-[11px] text-red-400/60 mt-0.5">{conv.title}</div>
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); onDelete(conv.id); setConfirmId(null); }}
                        className="px-2 py-1 rounded-md text-[11px] font-bold bg-red-500/20 text-red-400 hover:bg-red-500/40 transition-colors"
                      >
                        Yes
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setConfirmId(null); }}
                        className="px-2 py-1 rounded-md text-[11px] font-bold text-gray-8 hover:bg-white/[0.06] transition-colors"
                      >
                        No
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-sm text-gray-11 truncate pr-6">{conv.title}</div>
                    <div className="text-[11px] text-gray-8 mt-0.5">{new Date(conv.updated_at).toLocaleDateString()}</div>
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmId(conv.id); }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md opacity-0 group-hover:opacity-100 hover:bg-white/[0.08] text-gray-8 hover:text-red-400 transition-all min-h-[44px] min-w-[44px]"
                      aria-label="Delete conversation"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 6h18" /><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                      </svg>
                    </button>
                  </>
                )}
              </button>
            ))}
          </div>
        </SheetContent>
      </Sheet>
      <button onClick={onNew} className="text-xs text-white font-bold px-4 py-2.5 min-h-[44px] rounded-full bg-gradient-to-br from-ruby-9 to-ruby-10">
        + New
      </button>
    </div>
  );
}
