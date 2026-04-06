"use client";

import { cn } from "@/lib/utils";
import type { DocumentCategory } from "@/lib/types";
import { useLanguage } from "@/lib/i18n";

interface DocumentFiltersProps {
  activeFilter: DocumentCategory | "all";
  onFilterChange: (filter: DocumentCategory | "all") => void;
}

export function DocumentFilters({ activeFilter, onFilterChange }: DocumentFiltersProps) {
  const { t } = useLanguage();

  const filters: { label: string; value: DocumentCategory | "all" }[] = [
    { label: t("documents.all"), value: "all" },
    { label: t("documents.launchpad"), value: "launchpad" },
    { label: t("documents.memo"), value: "memo" },
    { label: t("documents.knowledge"), value: "knowledge" },
    { label: t("documents.promotions"), value: "promotions" },
    { label: t("documents.premiumTables"), value: "premium_table" },
    { label: t("documents.comparisons"), value: "comparison" },
    { label: t("documents.uwGuidelines"), value: "underwriting_guideline" },
    { label: t("documents.claimGuidelines"), value: "claim_guideline" },
    { label: t("documents.email"), value: "email_attachment" },
    { label: t("documents.other"), value: "other" },
  ];

  return (
    <div className="flex gap-1.5 overflow-x-auto pb-2 scrollbar-none">
      {filters.map((filter) => (
        <button
          key={filter.value}
          onClick={() => onFilterChange(filter.value)}
          className={cn(
            "text-xs font-semibold px-3.5 py-1.5 rounded-full border whitespace-nowrap transition-all min-h-[44px]",
            activeFilter === filter.value
              ? "text-gray-12 bg-gradient-to-b from-white/[0.06] to-white/[0.02] border-transparent border-b-2 border-b-ruby-9"
              : "text-gray-8 border-white/5 hover:text-gray-11 hover:border-white/10"
          )}
        >
          {filter.label}
        </button>
      ))}
    </div>
  );
}
