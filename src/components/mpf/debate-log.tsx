"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, MessageSquare } from "lucide-react";

interface DebateLogProps {
  summaryEn: string;
  summaryZh: string;
  fullLog: string;
  createdAt: string;
}

export function DebateLog({ summaryEn, summaryZh, fullLog, createdAt }: DebateLogProps) {
  const [expanded, setExpanded] = useState(false);

  const summary = summaryEn.split("---")[0].trim();
  const debateContent = fullLog || summaryEn.split("---").slice(1).join("---").trim();

  return (
    <div className="mt-4 border border-zinc-800/60 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-900/40 transition-colors"
      >
        <div className="flex items-center gap-2">
          <MessageSquare className="w-3.5 h-3.5 text-zinc-400" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-300">
            Why This Allocation
          </span>
          <span className="text-[10px] font-mono text-zinc-500">
            {new Date(createdAt).toLocaleDateString("en-HK")}
          </span>
        </div>
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-zinc-400" />
        ) : (
          <ChevronRight className="w-4 h-4 text-zinc-400" />
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-zinc-800/40">
          <p className="text-[13px] text-zinc-300 leading-relaxed mt-3 mb-4">
            {summary}
          </p>
          {debateContent && (
            <div className="bg-zinc-950/50 rounded-md p-4 text-[12px] font-mono text-zinc-400 leading-relaxed whitespace-pre-wrap max-h-[400px] overflow-y-auto">
              {debateContent}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
