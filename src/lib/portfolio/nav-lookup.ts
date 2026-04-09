// src/lib/portfolio/nav-lookup.ts — Shared NAV lookup helpers for MPF and ILAS
// Used by both portfolio trackers and the future reconcile cron.

import { createAdminClient } from "@/lib/supabase/admin";

export type Product = "mpf" | "ilas";

function fundsTable(product: Product): string {
  return product === "mpf" ? "mpf_funds" : "ilas_funds";
}

function pricesTable(product: Product): string {
  return product === "mpf" ? "mpf_prices" : "ilas_prices";
}

/**
 * Find exact-date NAV for a fund.
 * Returns the NAV as a number, or null if no row exists for that exact date.
 * NEVER falls back to the closest date.
 */
export async function getExactNav(
  product: Product,
  fundCode: string,
  dateStr: string
): Promise<number | null> {
  const supabase = createAdminClient();

  const { data: fund, error: fundError } = await supabase
    .from(fundsTable(product))
    .select("id")
    .eq("fund_code", fundCode)
    .single();
  if (fundError)
    console.error(`[nav-lookup] getExactNav(${product}) fund lookup:`, fundError);
  if (!fund) return null;

  const { data: price, error: priceError } = await supabase
    .from(pricesTable(product))
    .select("nav")
    .eq("fund_id", fund.id)
    .eq("date", dateStr)
    .single();
  if (priceError)
    console.error(`[nav-lookup] getExactNav(${product}) price lookup:`, priceError);

  return price ? Number(price.nav) : null;
}

/**
 * Find the most recent NAV on or before the requested date.
 * Used for daily NAV computation — NOT for settlement pricing.
 * Returns the NAV as a number, or null if no price row exists at or before dateStr.
 */
export async function getClosestNav(
  product: Product,
  fundCode: string,
  dateStr: string
): Promise<number | null> {
  const supabase = createAdminClient();

  const { data: fund, error: fundError } = await supabase
    .from(fundsTable(product))
    .select("id")
    .eq("fund_code", fundCode)
    .single();
  if (fundError)
    console.error(`[nav-lookup] getClosestNav(${product}) fund lookup:`, fundError);
  if (!fund) return null;

  const { data: price, error: priceError } = await supabase
    .from(pricesTable(product))
    .select("nav")
    .eq("fund_id", fund.id)
    .lte("date", dateStr)
    .order("date", { ascending: false })
    .limit(1)
    .single();
  if (priceError)
    console.error(`[nav-lookup] getClosestNav(${product}) price lookup:`, priceError);

  return price ? Number(price.nav) : null;
}
