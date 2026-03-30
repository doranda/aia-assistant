"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import type { Document, UserRole } from "@/lib/types";
import { canDeleteDocument, canSuggestDelete } from "@/lib/permissions";
import { cn } from "@/lib/utils";

function statusBadge(status: Document["status"]) {
  const config: Record<Document["status"], { label: string; className: string }> = {
    indexed: { label: "Indexed", className: "text-status-green-light bg-[rgba(48,209,88,0.08)] shadow-[0_0_8px_rgba(48,209,88,0.12)]" },
    processing: { label: "Processing", className: "text-status-amber-light bg-[rgba(255,197,61,0.08)]" },
    pending: { label: "Pending", className: "text-gray-9 bg-gray-3" },
    pending_review: { label: "Pending Review", className: "text-status-amber-light bg-[rgba(255,197,61,0.08)]" },
    error: { label: "Error", className: "text-ruby-11 bg-ruby-3" },
  };
  const { label, className } = config[status];
  return <Badge variant="outline" className={`${className} border-0 text-[11px] font-semibold`}>{label}</Badge>;
}

function formatDate(dateStr: string) {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours < 1) return "Just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function formatCategory(cat: string) {
  return cat.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

interface DocumentTableProps {
  documents: Document[];
  onEdit: (doc: Document) => void;
  onIngest?: (docId: string) => void;
  ingestingId?: string | null;
  userRole?: UserRole;
}

export function DocumentTable({ documents, onEdit, onIngest, ingestingId, userRole }: DocumentTableProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleDelete(docId: string) {
    if (!userRole) return;

    const isRequest = canSuggestDelete(userRole);
    const confirmMsg = isRequest
      ? "Request deletion of this document?"
      : "Delete this document permanently?";

    if (!confirm(confirmMsg)) return;

    setDeletingId(docId);
    try {
      const res = await fetch("/api/documents", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: docId,
          reason: isRequest ? "Requested via document table" : undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Failed");
      } else {
        const data = await res.json();
        if (data.requested) {
          toast.success("Delete request submitted for review");
        } else {
          toast.success("Document deleted");
          window.location.reload();
        }
      }
    } catch {
      toast.error("Failed to process");
    }
    setDeletingId(null);
  }
  if (documents.length === 0) {
    return <div className="hidden lg:block text-center py-20"><p className="text-gray-8 text-sm">No documents found</p></div>;
  }

  return (
    <div className="hidden lg:block border-t border-white/[0.04] pt-2 overflow-x-auto">
      <table className="w-full border-collapse min-w-[800px]">
        <thead>
          <tr>
            {["Name", "Category", "Company", "Tags", "Status", "Uploaded", ""].map((h, i) => (
              <th key={h || `col-${i}`} className={cn("text-left py-3.5 text-[11px] text-gray-7 uppercase tracking-wider font-semibold border-b border-white/[0.06]", i === 6 && "w-10")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {documents.map((doc) => (
            <tr key={doc.id} className={cn("group cursor-pointer transition-all hover:bg-gradient-to-r hover:from-ruby-9/[0.04] hover:to-transparent", doc.status === "pending_review" && "[&>td:first-child]:border-l-2 [&>td:first-child]:border-l-[rgba(255,197,61,0.3)] [&>td:first-child]:pl-3")}>
              <td className="py-4 text-sm font-semibold text-gray-12 group-hover:text-white border-b border-white/[0.03]">{doc.title}</td>
              <td className="py-4 text-sm text-gray-10 border-b border-white/[0.03]">{formatCategory(doc.category)}</td>
              <td className="py-4 text-sm text-gray-10 border-b border-white/[0.03]">{doc.company || "—"}</td>
              <td className="py-4 border-b border-white/[0.03]">
                {doc.tags.map((tag) => (
                  <span key={tag} className="text-[11px] text-gray-8 font-medium bg-white/[0.04] px-2 py-0.5 rounded mr-2">{tag}</span>
                ))}
              </td>
              <td className="py-4 border-b border-white/[0.03]">
                <div className="flex items-center gap-2">
                  {statusBadge(doc.status)}
                  {doc.status !== "indexed" && doc.status !== "processing" && onIngest && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onIngest(doc.id); }}
                      disabled={ingestingId === doc.id}
                      className="text-[10px] font-semibold text-amber-400 hover:text-amber-300 transition-colors disabled:opacity-40"
                    >
                      {ingestingId === doc.id ? "Indexing..." : "Index now"}
                    </button>
                  )}
                </div>
              </td>
              <td className="py-4 text-sm text-gray-10 border-b border-white/[0.03] tabular-nums">
                {doc.source === "web_search" ? "Web · " : ""}{formatDate(doc.created_at)}
              </td>
              <td className="py-4 border-b border-white/[0.03]">
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                  <button
                    onClick={() => onEdit(doc)}
                    className="text-gray-8 hover:text-gray-12 p-1 rounded-md hover:bg-white/[0.05]"
                    aria-label="Edit document"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                  {userRole && (canDeleteDocument(userRole) || canSuggestDelete(userRole)) && (
                    <button
                      onClick={() => handleDelete(doc.id)}
                      disabled={deletingId === doc.id}
                      className="text-gray-8 hover:text-ruby-11 p-1 rounded-md hover:bg-ruby-9/[0.05] disabled:opacity-40"
                      aria-label={canDeleteDocument(userRole) ? "Delete" : "Request delete"}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
