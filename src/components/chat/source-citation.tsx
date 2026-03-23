import type { MessageSource } from "@/lib/types";

interface SourceCitationProps {
  source: MessageSource;
  index?: number;
}

export function SourceCitation({ source, index }: SourceCitationProps) {
  return (
    <button
      className="flex items-start gap-3 px-3 py-2.5 rounded-[6px] bg-[#18181B] border border-white/[0.06] hover:border-[#D71920]/30 hover:bg-[#D71920]/[0.04] transition-all text-left w-full"
      title={`${source.document_title}, page ${source.page_number}`}
    >
      {index != null && (
        <span className="shrink-0 mt-0.5 text-[11px] font-semibold text-[#D71920] font-mono">
          [{index + 1}]
        </span>
      )}
      <div className="min-w-0">
        <p className="text-[13px] text-[#FAFAFA] leading-snug truncate">
          {source.document_title}
        </p>
        <p className="text-[11px] font-mono text-[#52525B] mt-0.5">
          p.{source.page_number}
        </p>
      </div>
    </button>
  );
}
