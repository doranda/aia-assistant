// src/lib/mpf/constants.ts — Static MPF configuration

import type { FundCategory } from "./types";

// 5 funds discontinued by AIA June 2023 — Fidelity series + HK/Japan equity.
// Last real NAV ranges Jun 2023 (FGR/FSG/FCS) → Dec 2023 (HEF) → Aug 2021 (JEF).
// Screener/heatmap/scoring should exclude; detail page shows DISCONTINUED badge.
export const DISCONTINUED_FUND_CODES: ReadonlySet<string> = new Set([
  "AIA-HEF",
  "AIA-JEF",
  "AIA-FGR",
  "AIA-FSG",
  "AIA-FCS",
]);

export function isDiscontinuedFund(fund_code: string): boolean {
  return DISCONTINUED_FUND_CODES.has(fund_code);
}

// All 20 active AIA MPF funds (Prime Value Choice scheme)
// Source: https://www.aia.com.hk/en/products/mpf/list (verified 2026-03-25)
export const AIA_FUNDS = [
  { fund_code: "AIA-AEF", name_en: "Asian Equity Fund", name_zh: "亞洲股票基金", category: "equity" as FundCategory, risk_rating: 5 },
  { fund_code: "AIA-EEF", name_en: "European Equity Fund", name_zh: "歐洲股票基金", category: "equity" as FundCategory, risk_rating: 5 },
  { fund_code: "AIA-GCF", name_en: "Greater China Equity Fund", name_zh: "大中華股票基金", category: "equity" as FundCategory, risk_rating: 5 },
  { fund_code: "AIA-NAF", name_en: "North American Equity Fund", name_zh: "北美股票基金", category: "equity" as FundCategory, risk_rating: 5 },
  { fund_code: "AIA-GRF", name_en: "Green Fund", name_zh: "綠色基金", category: "equity" as FundCategory, risk_rating: 5 },
  { fund_code: "AIA-AMI", name_en: "American Fund", name_zh: "美國基金", category: "index" as FundCategory, risk_rating: 4 },
  { fund_code: "AIA-EAI", name_en: "Eurasia Fund", name_zh: "歐亞基金", category: "index" as FundCategory, risk_rating: 4 },
  { fund_code: "AIA-HCI", name_en: "HK & China Fund", name_zh: "香港及中國基金", category: "index" as FundCategory, risk_rating: 4 },
  { fund_code: "AIA-WIF", name_en: "World Fund", name_zh: "環球基金", category: "index" as FundCategory, risk_rating: 4 },
  { fund_code: "AIA-GRW", name_en: "Growth Portfolio", name_zh: "增長投資組合", category: "mixed" as FundCategory, risk_rating: 4 },
  { fund_code: "AIA-BAL", name_en: "Balanced Portfolio", name_zh: "均衡投資組合", category: "mixed" as FundCategory, risk_rating: 3 },
  { fund_code: "AIA-CST", name_en: "Capital Stable Portfolio", name_zh: "資本穩定投資組合", category: "mixed" as FundCategory, risk_rating: 2 },
  { fund_code: "AIA-CHD", name_en: "China HK Dynamic Portfolio", name_zh: "中港動態投資組合", category: "dynamic" as FundCategory, risk_rating: 5 },
  { fund_code: "AIA-MCF", name_en: "Manager's Choice Portfolio", name_zh: "基金經理精選投資組合", category: "dynamic" as FundCategory, risk_rating: 4 },
  { fund_code: "AIA-ABF", name_en: "Asian Bond Fund", name_zh: "亞洲債券基金", category: "bond" as FundCategory, risk_rating: 2 },
  { fund_code: "AIA-GBF", name_en: "Global Bond Fund", name_zh: "環球債券基金", category: "bond" as FundCategory, risk_rating: 2 },
  { fund_code: "AIA-CON", name_en: "MPF Conservative Fund", name_zh: "強積金保守基金", category: "conservative" as FundCategory, risk_rating: 1 },
  { fund_code: "AIA-GPF", name_en: "Guaranteed Portfolio", name_zh: "保證投資組合", category: "guaranteed" as FundCategory, risk_rating: 1 },
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
  hk_equity: ["AIA-GCF", "AIA-HCI"],
  asia_equity: ["AIA-AEF"],
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
  fidelity: "Fidelity Series (Discontinued)",
  bond: "Fixed Income",
  conservative: "Conservative",
  guaranteed: "Guaranteed",
  dis: "Default Investment Strategy",
};

// AIA API fund code → internal fund code mapping
// Source: https://www3.aia-pt.com.hk/common_ws/aiapt/FundPrice/getFundPerformance/MPF/
export const AIA_API_CODE_MAP: Record<string, string> = {
  "3G": "AIA-AMI",
  "3E": "AIA-EAI",
  "3F": "AIA-HCI",
  "83": "AIA-WIF",
  "3D": "AIA-ABF",
  "63": "AIA-GBF",
  "R3": "AIA-CON",
  "3H": "AIA-CHD",
  "93": "AIA-MCF",
  "L3": "AIA-AEF",
  "E3": "AIA-EEF",
  "D3": "AIA-GCF",
  "N3": "AIA-NAF",
  "53": "AIA-GRF",
  "T3": "AIA-GPF",
  "W3": "AIA-GRW",
  "B3": "AIA-BAL",
  "V3": "AIA-CST",
  "NF": "AIA-CAF",
  "NA": "AIA-65P",
};

// Code → full name lookup for Discord alerts and UI
export const FUND_CODE_TO_NAME: Record<string, string> = Object.fromEntries(
  AIA_FUNDS.map(f => [f.fund_code, f.name_en])
);

/** Convert "AIA-CON 60%" to "MPF Conservative Fund 60%" */
export function formatAllocation(alloc: { code: string; weight: number }[]): string {
  return alloc
    .filter(a => a.weight > 0)
    .map(a => `${FUND_CODE_TO_NAME[a.code] || a.code} ${a.weight}%`)
    .join(" / ");
}

// Outlier threshold for alert triggers
export const PRICE_OUTLIER_THRESHOLD_PCT = 2;

// Insight disclaimer text
export const INSIGHT_DISCLAIMER = {
  en: "Internal reference material for AIA team discussion. Not financial advice. Generated by AIA MPF Care Profile.",
  zh: "此為AIA團隊內部討論參考資料，並非投資建議。由AIA強積金護理檔案生成。",
};

// Risk-free rate for Sharpe/Sortino (HIBOR approximate, annual)
export const RISK_FREE_RATE = 0.04;

// Investment profiles — two modes for debate rebalancer
// Mode 1: Age-based (35yo) — traditional lifecycle allocation
// Mode 2: Pure quant+news — no age assumption, purely data-driven
export const INVESTMENT_PROFILES = {
  age_based: {
    age: 35,
    equity_pct: 75, // 110 - age (informational anchor, NOT a floor)
    bond_pct: 25,
    label: "35yo Growth (age-based)",
  },
  pure_quant: {
    age: null,
    equity_pct: null, // no anchor — let the data decide
    bond_pct: null,
    label: "Pure Quantitative + News (no age assumption)",
  },
} as const;

// Default profile for backward compat
export const INVESTMENT_PROFILE = INVESTMENT_PROFILES.age_based;

// Fund Expense Ratios (FER %) — Source: MPFA published data 2025
// These are annual percentages. Lower is better.
export const FUND_EXPENSE_RATIOS: Record<string, number> = {
  "AIA-AEF": 1.73, "AIA-EEF": 1.76, "AIA-GCF": 1.74,
  "AIA-NAF": 1.71, "AIA-GRF": 1.59,
  "AIA-AMI": 0.97, "AIA-EAI": 0.99,
  "AIA-HCI": 0.86, "AIA-WIF": 0.99, "AIA-GRW": 1.69,
  "AIA-BAL": 1.67, "AIA-CST": 1.55, "AIA-CHD": 1.93,
  "AIA-MCF": 1.82,
  "AIA-ABF": 1.26, "AIA-GBF": 1.29,
  "AIA-CON": 0.39, "AIA-GPF": 1.88, "AIA-CAF": 0.81,
  "AIA-65P": 0.76,
};

// Screener category groupings
export const SCREENER_CATEGORIES = {
  All: null,
  Equity: ["equity", "index", "dynamic"] as FundCategory[],
  Bond: ["bond", "conservative", "guaranteed"] as FundCategory[],
  Mixed: ["mixed", "fidelity", "dis"] as FundCategory[],
} as const;

// Discontinued funds — terminated by AIA, no longer in the active lineup (as of June 2023)
// Historical price data kept in DB for backtesting purposes only
export const DISCONTINUED_FUNDS = ["AIA-HEF", "AIA-JEF", "AIA-FCS", "AIA-FGR", "AIA-FSG"];

// ===== Portfolio Tracking — T+2 Settlement =====

// Portfolio synthetic fund base
export const PORTFOLIO_BASE_NAV = 100.0;

// Settlement: submit T, sell T+1, buy T+2 (working days, forward pricing)
export const SETTLEMENT_DAYS = 2; // T+2 total (sell at T+1, buy at T+2)

// 7-day cooldown (calendar days) after settlement before next auto-switch
export const COOLDOWN_DAYS = 7;

// Cutoff: 3:30pm HKT (30-min buffer before AIA's 4pm cutoff)
// If rebalancer fires after this, decision_date = next working day
export const CUTOFF_HOUR_HKT = 15.5; // 15:30 = 3:30pm

// AIA Guaranteed Portfolio: hard limit of 2 switches per calendar year
export const GPF_MAX_SWITCHES_PER_YEAR = 2;

// Long weekend flag: if T+2 is more than this many calendar days away, flag for review
export const LONG_WEEKEND_THRESHOLD_DAYS = 4;
