"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { parseFilename } from "@/lib/parse-filename";
import type { DocumentCategory } from "@/lib/types";

const categories: { label: string; value: DocumentCategory }[] = [
  { label: "Brochure", value: "brochure" },
  { label: "Premium Table", value: "premium_table" },
  { label: "Comparison", value: "comparison" },
  { label: "Email Attachment", value: "email_attachment" },
  { label: "Underwriting Guideline", value: "underwriting_guideline" },
  { label: "Claim Guideline", value: "claim_guideline" },
];

interface PendingFile {
  file: File;
  title: string;
  category: DocumentCategory;
  company: string;
  tags: string;
}

interface UploadZoneProps {
  compact?: boolean;
}

export function UploadZone({ compact }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [showDialog, setShowDialog] = useState(false);
  const router = useRouter();

  const handleFiles = useCallback((files: FileList | File[]) => {
    const pdfFiles = Array.from(files).filter((f) => f.type === "application/pdf");
    if (pdfFiles.length === 0) {
      toast.error("Only PDF files are supported");
      return;
    }

    const pending = pdfFiles.map((file) => {
      const parsed = parseFilename(file.name);
      return {
        file,
        title: parsed.title,
        category: parsed.category,
        company: parsed.company,
        tags: parsed.tags.join(", "),
      };
    });

    setPendingFiles(pending);
    setShowDialog(true);
  }, []);

  function updatePending(index: number, updates: Partial<PendingFile>) {
    setPendingFiles((prev) =>
      prev.map((p, i) => (i === index ? { ...p, ...updates } : p))
    );
  }

  async function handleUpload() {
    setUploading(true);
    let successCount = 0;

    for (const pf of pendingFiles) {
      const formData = new FormData();
      formData.append("file", pf.file);
      formData.append("category", pf.category);
      if (pf.company.trim()) formData.append("company", pf.company.trim());
      if (pf.tags.trim()) formData.append("tags", pf.tags.trim());

      try {
        const res = await fetch("/api/documents", { method: "POST", body: formData });
        if (res.ok) {
          successCount++;
        } else {
          const data = await res.json();
          toast.error(`Failed: ${pf.title}: ${data.error}`);
        }
      } catch {
        toast.error(`Failed: ${pf.title}`);
      }
    }

    if (successCount > 0) {
      toast.success(`Uploaded ${successCount} document${successCount > 1 ? "s" : ""}`);
      router.refresh();
    }
    setUploading(false);
    setShowDialog(false);
    setPendingFiles([]);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) handleFiles(e.target.files);
  }

  const fileInput = (
    <input type="file" accept=".pdf" multiple onChange={handleFileInput} className="hidden" />
  );

  return (
    <>
      {compact ? (
        <label className="block cursor-pointer">
          {fileInput}
          <span className="text-xs text-white font-bold px-4 lg:px-5 py-2 rounded-full bg-gradient-to-br from-ruby-9 to-ruby-10 shadow-[0_0_20px_rgba(196,18,48,0.2)] hover:shadow-[0_0_30px_rgba(196,18,48,0.35)] hover:-translate-y-px active:translate-y-px active:scale-[0.96] transition-all inline-block">
            Upload PDF
          </span>
        </label>
      ) : (
        <label
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={`block border border-dashed rounded-[28px] p-16 lg:p-20 text-center cursor-pointer transition-all bg-[radial-gradient(ellipse_at_50%_50%,rgba(196,18,48,0.015)_0%,transparent_70%)] ${
            isDragging
              ? "border-ruby-9/40 bg-ruby-9/[0.02]"
              : "border-white/[0.06] hover:border-ruby-9/25 hover:bg-ruby-9/[0.015]"
          }`}
        >
          {fileInput}
          <svg className="mx-auto text-gray-7" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <p className="text-gray-9 text-base font-medium mt-4">Drop PDFs here or click to browse</p>
          <p className="text-gray-7 text-sm mt-1.5">Max 50MB · 200 pages · PDF only</p>
        </label>
      )}

      <Dialog open={showDialog} onOpenChange={(open) => { if (!open && !uploading) { setShowDialog(false); setPendingFiles([]); } }}>
        <DialogContent className="bg-gray-2 border-white/[0.06] text-gray-12 max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">
              Upload {pendingFiles.length} {pendingFiles.length === 1 ? "document" : "documents"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6 pt-2">
            {pendingFiles.map((pf, i) => (
              <div key={i} className={pendingFiles.length > 1 ? "pb-6 border-b border-white/[0.06] last:border-0" : ""}>
                {pendingFiles.length > 1 && (
                  <p className="text-xs text-gray-8 font-semibold uppercase tracking-wider mb-3">
                    File {i + 1} — {pf.file.name}
                  </p>
                )}

                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-gray-11">Title</Label>
                    <Input
                      value={pf.title}
                      onChange={(e) => updatePending(i, { title: e.target.value })}
                      className="h-9 bg-white/5 border-white/8 text-gray-12 text-sm"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-gray-11">Category</Label>
                      <Select
                        value={pf.category}
                        onValueChange={(v) => updatePending(i, { category: v as DocumentCategory })}
                      >
                        <SelectTrigger className="h-9 bg-white/5 border-white/8 text-gray-12 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-gray-2 border-white/[0.06]">
                          {categories.map((c) => (
                            <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs text-gray-11">Company {pf.company && <span className="text-ruby-11">(auto-detected)</span>}</Label>
                      <Input
                        value={pf.company}
                        onChange={(e) => updatePending(i, { company: e.target.value })}
                        placeholder="e.g. AIA, FWD"
                        className="h-9 bg-white/5 border-white/8 text-gray-12 text-sm placeholder:text-gray-8"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs text-gray-11">Tags {pf.tags && <span className="text-ruby-11">(auto-detected)</span>}</Label>
                    <Input
                      value={pf.tags}
                      onChange={(e) => updatePending(i, { tags: e.target.value })}
                      placeholder="VHIS, health, CI (comma separated)"
                      className="h-9 bg-white/5 border-white/8 text-gray-12 text-sm placeholder:text-gray-8"
                    />
                  </div>
                </div>
              </div>
            ))}

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="ghost"
                onClick={() => { setShowDialog(false); setPendingFiles([]); }}
                disabled={uploading}
                className="text-gray-9 hover:text-gray-12"
              >
                Cancel
              </Button>
              <Button
                onClick={handleUpload}
                disabled={uploading || pendingFiles.some((pf) => !pf.title.trim())}
                className="bg-gradient-to-br from-ruby-9 to-ruby-10 text-white font-bold hover:shadow-[0_0_20px_rgba(196,18,48,0.3)]"
              >
                {uploading ? "Uploading..." : `Upload ${pendingFiles.length === 1 ? "" : `${pendingFiles.length} files`}`}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
