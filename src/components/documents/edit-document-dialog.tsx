"use client";

import { useState } from "react";
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
import type { Document, DocumentCategory } from "@/lib/types";

const categories: { label: string; value: DocumentCategory }[] = [
  { label: "Launchpad", value: "launchpad" },
  { label: "Memo", value: "memo" },
  { label: "Knowledge", value: "knowledge" },
  { label: "Promotions", value: "promotions" },
  { label: "Premium Table", value: "premium_table" },
  { label: "Comparison", value: "comparison" },
  { label: "Email Attachment", value: "email_attachment" },
  { label: "Underwriting Guideline", value: "underwriting_guideline" },
  { label: "Claim Guideline", value: "claim_guideline" },
  { label: "Other", value: "other" },
];

interface EditDocumentDialogProps {
  document: Document;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditDocumentDialog({
  document: doc,
  open,
  onOpenChange,
}: EditDocumentDialogProps) {
  const [title, setTitle] = useState(doc.title);
  const [category, setCategory] = useState<DocumentCategory>(doc.category);
  const [company, setCompany] = useState(doc.company || "");
  const [tagsInput, setTagsInput] = useState(doc.tags.join(", "));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const router = useRouter();

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);

    try {
      const res = await fetch("/api/documents", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: doc.id }),
      });

      if (res.ok) {
        toast.success("Document deleted");
        onOpenChange(false);
        router.refresh();
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to delete");
      }
    } catch {
      toast.error("Failed to delete document");
    }

    setDeleting(false);
  }

  async function handleSave() {
    setSaving(true);

    try {
      const res = await fetch("/api/documents", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: doc.id,
          title: title.trim(),
          category,
          company: company.trim(),
          tags: tagsInput
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        }),
      });

      if (res.ok) {
        toast.success("Document updated");
        onOpenChange(false);
        router.refresh();
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to update");
      }
    } catch {
      toast.error("Failed to update document");
    }

    setSaving(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-gray-2 border-white/[0.06] text-gray-12 max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">Edit Document</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label className="text-sm text-gray-11">Title</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="bg-white/5 border-white/8 text-gray-12"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm text-gray-11">Category</Label>
            <Select
              value={category}
              onValueChange={(v) => setCategory(v as DocumentCategory)}
            >
              <SelectTrigger className="bg-white/5 border-white/8 text-gray-12">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-gray-2 border-white/[0.06]">
                {categories.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-sm text-gray-11">Company</Label>
            <Input
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="e.g. AIA, Prudential, FWD"
              className="bg-white/5 border-white/8 text-gray-12 placeholder:text-gray-8"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm text-gray-11">Tags</Label>
            <Input
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="VHIS, health, CI (comma separated)"
              className="bg-white/5 border-white/8 text-gray-12 placeholder:text-gray-8"
            />
          </div>

          <div className="flex justify-between pt-4 border-t border-white/[0.06]">
            <Button
              variant="ghost"
              onClick={handleDelete}
              disabled={deleting || saving}
              className={confirmDelete ? "bg-ruby-9 text-white hover:bg-ruby-10" : "text-ruby-11 hover:text-ruby-12 hover:bg-ruby-3/50"}
            >
              {deleting ? "Deleting..." : confirmDelete ? "Confirm delete?" : "Delete"}
            </Button>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                onClick={() => onOpenChange(false)}
                className="text-gray-9 hover:text-gray-12"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || !title.trim()}
                className="bg-gradient-to-br from-ruby-9 to-ruby-10 text-white font-bold hover:shadow-[0_0_20px_rgba(196,18,48,0.3)]"
              >
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
