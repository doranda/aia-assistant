// src/components/mpf/fund-heading.tsx
"use client";

import { useLanguage, getFundName } from "@/lib/i18n";

interface FundHeadingProps {
  fund: {
    name_en: string;
    name_zh?: string | null;
  };
  className?: string;
}

export function FundHeading({ fund, className }: FundHeadingProps) {
  const { locale } = useLanguage();
  return <>{getFundName(fund, locale)}</>;
}
