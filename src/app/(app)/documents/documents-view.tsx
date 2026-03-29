"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Document, DocumentCategory, UserRole } from "@/lib/types";
import { DocumentFilters } from "@/components/documents/document-filters";
import { DocumentTable } from "@/components/documents/document-table";
import { DocumentCard } from "@/components/documents/document-card";
import { UploadZone } from "@/components/documents/upload-zone";
import { EditDocumentDialog } from "@/components/documents/edit-document-dialog";

export function DocumentsView({ documents, userRole }: { documents: Document[]; userRole?: UserRole }) {
  const [filter, setFilter] = useState<DocumentCategory | "all">("all");
  const [editingDoc, setEditingDoc] = useState<Document | null>(null);
  const [ingesting, setIngesting] = useState(false);
  const [ingestingId, setIngestingId] = useState<string | null>(null);
  const router = useRouter();

  const filtered = filter === "all" ? documents : documents.filter((d) => d.category === filter);
  const pendingCount = documents.filter((d) => d.status === "pending" || d.status === "error").length;

  async function handleIngestAll() {
    setIngesting(true);
    try {
      const res = await fetch("/api/documents/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "all-pending" }),
      });
      const data = await res.json();
      if (data.success > 0) {
        toast.success(`${data.success} document${data.success > 1 ? "s" : ""} indexed`);
        router.refresh();
      } else if (data.processed === 0) {
        toast.info("All documents already indexed");
      } else {
        toast.error(`Ingestion failed for ${data.processed - data.success} documents`);
      }
    } catch {
      toast.error("Failed to ingest documents");
    }
    setIngesting(false);
  }

  async function handleRebuildAll() {
    setIngesting(true);
    try {
      const res = await fetch("/api/documents/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "rebuild-all" }),
      });
      const data = await res.json();
      toast.success(`${data.success}/${data.processed} documents re-indexed`);
      router.refresh();
    } catch {
      toast.error("Rebuild failed");
    }
    setIngesting(false);
  }

  async function handleIngestSingle(docId: string) {
    setIngestingId(docId);
    try {
      const res = await fetch("/api/documents/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: docId }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Indexed — ${data.chunkCount} chunks`);
        router.refresh();
      } else {
        toast.error(`Failed: ${data.error}`);
      }
    } catch {
      toast.error("Ingestion failed");
    }
    setIngestingId(null);
  }

  return (
    <main className="max-w-[980px] mx-auto px-6 pt-16 lg:pt-24 pb-24">
      <div className="flex items-baseline justify-between mb-10 lg:mb-14">
        <h1 className="text-3xl lg:text-[40px] font-extrabold tracking-tight bg-gradient-to-b from-[#f5f5f7] to-white/70 bg-clip-text text-transparent">
          Documents
        </h1>
        <div className="flex gap-2">
          {pendingCount > 0 && (
            <button
              onClick={handleIngestAll}
              disabled={ingesting}
              className="hidden lg:flex items-center gap-1.5 text-xs text-amber-400 font-semibold px-4 py-2 rounded-full border border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10 transition-all disabled:opacity-40"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 1 1-6.2-8.6" /><path d="M21 3v9h-9" />
              </svg>
              {ingesting ? "Indexing..." : `Index ${pendingCount} pending`}
            </button>
          )}
          <button
            onClick={handleRebuildAll}
            disabled={ingesting}
            className="hidden lg:flex items-center gap-1.5 text-xs text-gray-9 font-semibold px-4 py-2 rounded-full border border-white/[0.06] hover:text-gray-12 hover:border-white/[0.12] transition-all disabled:opacity-40"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 1 1-6.2-8.6" /><path d="M21 3v9h-9" />
            </svg>
            {ingesting ? "Rebuilding..." : "Rebuild all"}
          </button>
          <UploadZone compact />
        </div>
      </div>

      {documents.length === 0 && (
        <div className="mb-12">
          <UploadZone />
        </div>
      )}

      <div className="mb-7">
        <DocumentFilters activeFilter={filter} onFilterChange={setFilter} />
      </div>

      <DocumentTable documents={filtered} onEdit={setEditingDoc} onIngest={handleIngestSingle} ingestingId={ingestingId} userRole={userRole} />
      <div className="lg:hidden">
        {filtered.length === 0 ? (
          <div className="text-center py-16"><p className="text-gray-8 text-sm">No documents found</p></div>
        ) : (
          filtered.map((doc) => (
            <DocumentCard key={doc.id} document={doc} onEdit={setEditingDoc} onIngest={handleIngestSingle} ingestingId={ingestingId} />
          ))
        )}
      </div>

      {editingDoc && (
        <EditDocumentDialog
          document={editingDoc}
          open={!!editingDoc}
          onOpenChange={(open) => { if (!open) setEditingDoc(null); }}
        />
      )}
    </main>
  );
}
