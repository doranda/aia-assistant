"use client";

import { cn } from "@/lib/utils";
import type { DocumentCategory } from "@/lib/types";

const filters: { label: string; value: DocumentCategory | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Brochures", value: "brochure" },
  { label: "Premium Tables", value: "premium_table" },
  { label: "Comparisons", value: "comparison" },
  { label: "UW Guidelines", value: "underwriting_guideline" },
  { label: "Claim Guidelines", value: "claim_guideline" },
  { label: "Email", value: "email_attachment" },
];

interface DocumentFiltersProps {
  activeFilter: DocumentCategory | "all";
  onFilterChange: (filter: DocumentCategory | "all") => void;
}

export function DocumentFilters({ activeFilter, onFilterChange }: DocumentFiltersProps) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-2 scrollbar-none">
      {filters.map((filter) => (
        <button
          key={filter.value}
          onClick={() => onFilterChange(filter.value)}
          className={cn(
            "text-xs font-semibold px-3.5 py-1.5 rounded-full border whitespace-nowrap transition-all",
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
