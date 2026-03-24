// src/lib/mpf/scrapers/brave-search.ts — Backfill NAV data for 5 missing funds
import { createAdminClient } from "@/lib/supabase/admin";
import { MISSING_DAILY_DATA_FUNDS, AIA_FUNDS } from "../constants";

const BRAVE_API = "https://api.search.brave.com/res/v1/web/search";

interface BraveSearchResult {
  title: string;
  url: string;
  description: string;
  extra_snippets?: string[];
}

export async function fetchMissingFundPrices(): Promise<number> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) {
    console.log("[brave-search] No BRAVE_SEARCH_API_KEY, skipping");
    return 0;
  }

  const supabase = createAdminClient();
  let inserted = 0;

  for (const fundCode of MISSING_DAILY_DATA_FUNDS) {
    const fundInfo = AIA_FUNDS.find(f => f.fund_code === fundCode);
    if (!fundInfo) continue;

    const now = new Date();
    const monthYear = now.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    const query = `AIA MPF "${fundInfo.name_en}" unit price ${monthYear}`;

    try {
      const res = await fetch(`${BRAVE_API}?q=${encodeURIComponent(query)}&count=5`, {
        headers: { "X-Subscription-Token": apiKey, Accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        console.error(`[brave-search] API error ${res.status} for ${fundCode}`);
        continue;
      }

      const data = await res.json();
      const results: BraveSearchResult[] = data.web?.results || [];

      let nav: number | null = null;
      let priceDate: string | null = null;

      for (const result of results) {
        const text = [result.description, ...(result.extra_snippets || [])].join(" ");

        const navMatch = text.match(/(?:NAV|price|unit\s*price)[:\s]*(?:HK?\$?)?\s*(\d+\.?\d{0,4})/i)
          || text.match(/(?:HK?\$)\s*(\d+\.?\d{0,4})/i);

        if (navMatch) {
          const parsed = parseFloat(navMatch[1]);
          if (parsed >= 0.5 && parsed <= 500) {
            nav = parsed;
            const dateMatch = text.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
            if (dateMatch) {
              const year = dateMatch[3].length === 2 ? `20${dateMatch[3]}` : dateMatch[3];
              priceDate = `${year}-${dateMatch[2].padStart(2, "0")}-${dateMatch[1].padStart(2, "0")}`;
            }
            break;
          }
        }
      }

      if (nav === null) {
        console.log(`[brave-search] No NAV found for ${fundCode}`);
        continue;
      }

      if (!priceDate) {
        priceDate = new Date().toISOString().split("T")[0];
      }

      const { data: fund } = await supabase
        .from("mpf_funds")
        .select("id")
        .eq("fund_code", fundCode)
        .single();

      if (!fund) continue;

      const { data: existing } = await supabase
        .from("mpf_prices")
        .select("id")
        .eq("fund_id", fund.id)
        .eq("date", priceDate)
        .single();

      if (existing) {
        console.log(`[brave-search] ${fundCode} already has price for ${priceDate}`);
        continue;
      }

      const { data: prevPrice } = await supabase
        .from("mpf_prices")
        .select("nav")
        .eq("fund_id", fund.id)
        .lt("date", priceDate)
        .order("date", { ascending: false })
        .limit(1)
        .single();

      const dailyChange = prevPrice ? ((nav - prevPrice.nav) / prevPrice.nav) * 100 : null;

      await supabase.from("mpf_prices").insert({
        fund_id: fund.id,
        date: priceDate,
        nav,
        daily_change_pct: dailyChange,
        source: "brave_search",
      });

      inserted++;
      console.log(`[brave-search] ${fundCode}: NAV ${nav} on ${priceDate}`);
    } catch (err) {
      console.error(`[brave-search] Error for ${fundCode}:`, err);
    }
  }

  return inserted;
}
