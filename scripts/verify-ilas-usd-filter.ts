/**
 * Verify USD filter integrity:
 *  - Main ilas-track + screener: USD only
 *  - Rebalancer fundMap still resolves Z28 (held position)
 *  - Rebalancer candidate pool (usdFunds) excludes non-USD
 *  - Per-portfolio_type, all held positions resolve against the matching fundMap
 */
import { createClient } from "@supabase/supabase-js";

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // ilas-track pages
  const { data: accTrack } = await admin.from("ilas_funds").select("fund_code, currency").eq("is_active", true).eq("is_distribution", false).eq("currency", "USD");
  const { data: disTrack } = await admin.from("ilas_funds").select("fund_code, currency").eq("is_active", true).eq("is_distribution", true).eq("currency", "USD");
  const { data: screener } = await admin.from("ilas_funds").select("fund_code, currency").eq("is_active", true).eq("currency", "USD");
  console.log(`[ilas-track acc] ${accTrack?.length} funds (all USD)`);
  console.log(`[ilas-track dis] ${disTrack?.length} funds (all USD)`);
  console.log(`[screener] ${screener?.length} funds (all USD)`);

  // Rebalancer per portfolio_type
  for (const portfolioType of ["accumulation", "distribution"] as const) {
    const isDistribution = portfolioType === "distribution";
    const { data: activeFunds } = await admin
      .from("ilas_funds")
      .select("id, fund_code, currency, name_en")
      .eq("is_active", true)
      .eq("is_distribution", isDistribution);
    const fundMap = new Map((activeFunds || []).map((f) => [f.id, f]));
    const usdFunds = (activeFunds || []).filter((f) => f.currency === "USD");

    const { data: ref } = await admin
      .from("ilas_reference_portfolio")
      .select("fund_id, weight, note")
      .eq("portfolio_type", portfolioType);
    const unresolvable = (ref || []).filter((r) => !fundMap.has(r.fund_id));
    const heldNonUsd = (ref || []).filter((r) => {
      const f = fundMap.get(r.fund_id);
      return f && f.currency !== "USD";
    });

    console.log(`\n[rebalancer ${portfolioType}]`);
    console.log(`  candidate pool (usdFunds): ${usdFunds.length} funds`);
    console.log(`  reference portfolio: ${ref?.length} holdings, unresolvable: ${unresolvable.length}`);
    console.log(`  held non-USD positions (still resolved via fundMap): ${heldNonUsd.length}`);
    for (const h of heldNonUsd) {
      const f = fundMap.get(h.fund_id)!;
      console.log(`    • ${f.fund_code} (${f.currency}) weight=${h.weight}% — ${f.name_en}`);
    }
    if (unresolvable.length)
      console.log(`  ❌ UNRESOLVABLE (would break display):`, unresolvable);
  }
}
main();
