import { Badge } from "@/components/ui/badge";
import type { Document } from "@/lib/types";

function statusBadge(status: Document["status"]) {
  const styles: Record<Document["status"], string> = {
    indexed: "text-status-green-light bg-[rgba(48,209,88,0.08)]",
    processing: "text-status-amber-light bg-[rgba(255,197,61,0.08)]",
    pending: "text-gray-9 bg-gray-3",
    pending_review: "text-status-amber-light bg-[rgba(255,197,61,0.08)]",
    error: "text-ruby-11 bg-ruby-3",
  };
  const labels: Record<Document["status"], string> = {
    indexed: "Indexed", processing: "Processing", pending: "Pending",
    pending_review: "Review", error: "Error",
  };
  return <Badge variant="outline" className={`${styles[status]} border-0 text-[11px] font-semibold`}>{labels[status]}</Badge>;
}

function formatCategory(cat: string) {
  return cat.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

interface DocumentCardProps {
  document: Document;
  onEdit: (doc: Document) => void;
  onIngest?: (docId: string) => void;
  ingestingId?: string | null;
}

export function DocumentCard({ document: doc, onEdit, onIngest, ingestingId }: DocumentCardProps) {
  return (
    <div
      className="lg:hidden p-4 border-b border-white/[0.03] active:bg-white/[0.02] transition-colors"
      onClick={() => onEdit(doc)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-12 truncate">{doc.title}</p>
          <p className="text-xs text-gray-9 mt-1">
            {formatCategory(doc.category)}
            {doc.company && ` · ${doc.company}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {statusBadge(doc.status)}
          {doc.status !== "indexed" && doc.status !== "processing" && onIngest && (
            <button
              onClick={(e) => { e.stopPropagation(); onIngest(doc.id); }}
              disabled={ingestingId === doc.id}
              className="text-[10px] font-semibold text-amber-400 disabled:opacity-40"
            >
              {ingestingId === doc.id ? "..." : "Index"}
            </button>
          )}
        </div>
      </div>
      {doc.tags.length > 0 && (
        <div className="flex gap-1.5 mt-2">
          {doc.tags.map((tag) => (
            <span key={tag} className="text-[11px] text-gray-8 font-medium bg-white/[0.04] px-2 py-0.5 rounded">{tag}</span>
          ))}
        </div>
      )}
    </div>
  );
}
