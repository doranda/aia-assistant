// src/lib/mpf/constants.ts — Static MPF configuration

import type { FundCategory } from "./types";

// All 25 AIA MPF funds (Prime Value Choice scheme)
// Source: MPFA Fund Platform
export const AIA_FUNDS = [
  { fund_code: "AIA-AEF", name_en: "Asian Equity Fund", name_zh: "亞洲股票基金", category: "equity" as FundCategory, risk_rating: 5 },
  { fund_code: "AIA-EEF", name_en: "European Equity Fund", name_zh: "歐洲股票基金", category: "equity" as FundCategory, risk_rating: 5 },
  { fund_code: "AIA-GCF", name_en: "Greater China Equity Fund", name_zh: "大中華股票基金", category: "equity" as FundCategory, risk_rating: 5 },
  { fund_code: "AIA-HEF", name_en: "Hong Kong Equity Fund", name_zh: "香港股票基金", category: "equity" as FundCategory, risk_rating: 5 },
  { fund_code: "AIA-JEF", name_en: "Japan Equity Fund", name_zh: "日本股票基金", category: "equity" as FundCategory, risk_rating: 5 },
  { fund_code: "AIA-NAF", name_en: "North American Equity Fund", name_zh: "北美股票基金", category: "equity" as FundCategory, risk_rating: 5 },
  { fund_code: "AIA-GRF", name_en: "Green Fund", name_zh: "綠色基金", category: "equity" as FundCategory, risk_rating: 5 },
  { fund_code: "AIA-AMI", name_en: "American Index Fund", name_zh: "美國指數基金", category: "index" as FundCategory, risk_rating: 4 },
  { fund_code: "AIA-EAI", name_en: "Eurasia Index Fund", name_zh: "歐亞指數基金", category: "index" as FundCategory, risk_rating: 4 },
  { fund_code: "AIA-HCI", name_en: "HK & China Index Fund", name_zh: "香港及中國指數基金", category: "index" as FundCategory, risk_rating: 4 },
  { fund_code: "AIA-WIF", name_en: "World Index Fund", name_zh: "環球指數基金", category: "index" as FundCategory, risk_rating: 4 },
  { fund_code: "AIA-GRW", name_en: "Growth Fund", name_zh: "增長基金", category: "mixed" as FundCategory, risk_rating: 4 },
  { fund_code: "AIA-BAL", name_en: "Balanced Fund", name_zh: "均衡基金", category: "mixed" as FundCategory, risk_rating: 3 },
  { fund_code: "AIA-CST", name_en: "Capital Stable Fund", name_zh: "資本穩定基金", category: "mixed" as FundCategory, risk_rating: 2 },
  { fund_code: "AIA-CHD", name_en: "China HK Dynamic Fund", name_zh: "中港動態基金", category: "dynamic" as FundCategory, risk_rating: 5 },
  { fund_code: "AIA-MCF", name_en: "Manager's Choice Fund", name_zh: "基金經理精選基金", category: "dynamic" as FundCategory, risk_rating: 4 },
  { fund_code: "AIA-FGR", name_en: "Fidelity Growth Fund", name_zh: "富達增長基金", category: "fidelity" as FundCategory, risk_rating: 4 },
  { fund_code: "AIA-FSG", name_en: "Fidelity Stable Growth Fund", name_zh: "富達穩定增長基金", category: "fidelity" as FundCategory, risk_rating: 3 },
  { fund_code: "AIA-FCS", name_en: "Fidelity Capital Stable Fund", name_zh: "富達資本穩定基金", category: "fidelity" as FundCategory, risk_rating: 2 },
  { fund_code: "AIA-ABF", name_en: "Asian Bond Fund", name_zh: "亞洲債券基金", category: "bond" as FundCategory, risk_rating: 2 },
  { fund_code: "AIA-GBF", name_en: "Global Bond Fund", name_zh: "環球債券基金", category: "bond" as FundCategory, risk_rating: 2 },
  { fund_code: "AIA-CON", name_en: "MPF Conservative Fund", name_zh: "強積金保守基金", category: "conservative" as FundCategory, risk_rating: 1 },
  { fund_code: "AIA-GPF", name_en: "Guaranteed Portfolio Fund", name_zh: "保證基金", category: "guaranteed" as FundCategory, risk_rating: 1 },
  { fund_code: "AIA-CAF", name_en: "Core Accumulation Fund", name_zh: "核心累積基金", category: "dis" as FundCategory, risk_rating: 3 },
  { fund_code: "AIA-65P", name_en: "Age 65 Plus Fund", name_zh: "65歲後基金", category: "dis" as FundCategory, risk_rating: 2 },
] as const;

// Impact tag → fund category mapping (from design spec)
export const IMPACT_TAG_TO_CATEGORIES: Record<string, FundCategory[]> = {
  hk_equity: ["equity"],      // HK, Greater China funds
  asia_equity: ["equity"],     // Asian, Japan funds
  us_equity: ["equity", "index"], // North American, American Index
  eu_equity: ["equity", "index"], // European, Eurasia Index
  global_equity: ["index", "mixed"], // World Index, all mixed
  bond: ["bond"],
  fx: ["equity", "bond", "mixed", "index", "dynamic", "fidelity", "conservative", "guaranteed", "dis"], // affects all
  rates: ["bond", "guaranteed", "conservative"],
  china: ["equity", "dynamic"], // Greater China, China HK Dynamic
  green_esg: ["equity"],       // Green Fund
};

// Impact tag → specific fund codes (more precise mapping)
export const IMPACT_TAG_TO_FUNDS: Record<string, string[]> = {
  hk_equity: ["AIA-HEF", "AIA-GCF", "AIA-HCI"],
  asia_equity: ["AIA-AEF", "AIA-JEF"],
  us_equity: ["AIA-NAF", "AIA-AMI"],
  eu_equity: ["AIA-EEF", "AIA-EAI"],
  global_equity: ["AIA-WIF", "AIA-GRW", "AIA-BAL"],
  bond: ["AIA-ABF", "AIA-GBF"],
  rates: ["AIA-ABF", "AIA-GBF", "AIA-GPF", "AIA-CON", "AIA-CST"],
  china: ["AIA-GCF", "AIA-CHD", "AIA-HCI"],
  green_esg: ["AIA-GRF"],
};

// Fund categories for display grouping
export const FUND_CATEGORY_LABELS: Record<FundCategory, string> = {
  equity: "Equity (Regional/Thematic)",
  index: "Index-Tracking",
  mixed: "Mixed / Lifestyle",
  dynamic: "Dynamic",
  fidelity: "Fidelity Series",
  bond: "Fixed Income",
  conservative: "Conservative",
  guaranteed: "Guaranteed",
  dis: "Default Investment Strategy",
};

// Outlier threshold for alert triggers
export const PRICE_OUTLIER_THRESHOLD_PCT = 2;

// Insight disclaimer text
export const INSIGHT_DISCLAIMER = {
  en: "Internal reference material for AIA team discussion. Not financial advice. Generated by AIA MPF Care Profile.",
  zh: "此為AIA團隊內部討論參考資料，並非投資建議。由AIA強積金護理檔案生成。",
};
