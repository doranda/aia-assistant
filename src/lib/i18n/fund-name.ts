import type { Locale } from "./translations";

interface FundNameInput {
  name_en?: string | null;
  name_zh?: string | null;
}

/**
 * Returns the localized fund name. Falls back to name_en if zh is missing.
 */
export function getFundName(fund: FundNameInput, locale: Locale): string {
  if (locale === "zh" && fund.name_zh) return fund.name_zh;
  return fund.name_en ?? "";
}
