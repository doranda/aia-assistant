import type { DocumentCategory } from "./types";

const KNOWN_COMPANIES = [
  "AIA", "Prudential", "FWD", "Manulife", "AXA", "HSBC", "Zurich",
  "Sun Life", "Generali", "Chubb", "MetLife", "Cigna", "Bupa",
  "China Life", "BOC", "HKMC", "Allianz", "Aviva",
];

const TAG_KEYWORDS: Record<string, string> = {
  vhis: "VHIS", vhi: "VHIS", vhp: "VHP",
  ci: "CI", "critical illness": "CI",
  medical: "medical", health: "health",
  savings: "savings", saving: "savings",
  life: "life", term: "term",
  education: "education", endowment: "endowment",
  annuity: "annuity", retirement: "retirement",
  travel: "travel", accident: "accident",
  dental: "dental", maternity: "maternity",
  cancer: "cancer", premium: "premium",
};

const CATEGORY_HINTS: Record<string, DocumentCategory> = {
  brochure: "brochure", bro: "brochure",
  premium: "premium_table", "premium table": "premium_table", rate: "premium_table",
  comparison: "comparison", compare: "comparison", vs: "comparison",
  guideline: "underwriting_guideline", underwriting: "underwriting_guideline",
  claim: "claim_guideline", "claim guide": "claim_guideline",
};

export function parseFilename(filename: string) {
  const name = filename.replace(/\.pdf$/i, "");
  const lower = name.toLowerCase();

  // Detect company
  let company = "";
  for (const c of KNOWN_COMPANIES) {
    if (lower.includes(c.toLowerCase())) {
      company = c;
      break;
    }
  }

  // Detect tags
  const tags: string[] = [];
  for (const [keyword, tag] of Object.entries(TAG_KEYWORDS)) {
    if (lower.includes(keyword) && !tags.includes(tag)) {
      tags.push(tag);
    }
  }

  // Detect category
  let category: DocumentCategory = "brochure";
  for (const [hint, cat] of Object.entries(CATEGORY_HINTS)) {
    if (lower.includes(hint)) {
      category = cat;
      break;
    }
  }

  return { title: name, company, tags, category };
}
