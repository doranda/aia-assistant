"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useLanguage } from "@/lib/i18n";
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
  const { t } = useLanguage();

  const categories: { label: string; value: DocumentCategory }[] = [
    { label: t("documents.launchpad"), value: "launchpad" },
    { label: t("documents.memo"), value: "memo" },
    { label: t("documents.knowledge"), value: "knowledge" },
    { label: t("documents.promotions"), value: "promotions" },
    { label: t("documents.premiumTable"), value: "premium_table" },
    { label: t("documents.comparison"), value: "comparison" },
    { label: t("documents.emailAttachment"), value: "email_attachment" },
    { label: t("documents.uwGuideline"), value: "underwriting_guideline" },
    { label: t("documents.claimGuideline"), value: "claim_guideline" },
    { label: t("documents.other"), value: "other" },
  ];

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
        toast.success(t("documents.documentDeleted"));
        onOpenChange(false);
        router.refresh();
      } else {
        const data = await res.json();
        toast.error(data.error || t("documents.failedDelete"));
      }
    } catch {
      toast.error(t("documents.failedDelete"));
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
        toast.success(t("documents.documentUpdated"));
        onOpenChange(false);
        router.refresh();
      } else {
        const data = await res.json();
        toast.error(data.error || t("documents.failedUpdate"));
      }
    } catch {
      toast.error(t("documents.failedUpdate"));
    }

    setSaving(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-gray-2 border-white/[0.06] text-gray-12 max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">{t("documents.editDocument")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label className="text-sm text-gray-11">{t("documents.title")}</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="bg-white/5 border-white/8 text-gray-12"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm text-gray-11">{t("documents.category")}</Label>
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
            <Label className="text-sm text-gray-11">{t("documents.company")}</Label>
            <Input
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder={t("documents.companyEditPlaceholder")}
              className="bg-white/5 border-white/8 text-gray-12 placeholder:text-gray-8"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm text-gray-11">{t("documents.tags")}</Label>
            <Input
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder={t("documents.tagsPlaceholder")}
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
              {deleting ? t("documents.deleting") : confirmDelete ? t("documents.confirmDelete") : t("documents.delete")}
            </Button>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                onClick={() => onOpenChange(false)}
                className="text-gray-9 hover:text-gray-12"
              >
                {t("documents.cancel")}
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || !title.trim()}
                className="bg-gradient-to-br from-ruby-9 to-ruby-10 text-white font-bold hover:shadow-[0_0_20px_rgba(196,18,48,0.3)]"
              >
                {saving ? t("documents.saving") : t("documents.save")}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
