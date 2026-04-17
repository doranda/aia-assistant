/**
 * Check if any existing ILAS portfolio / order rows reference non-USD funds.
 */
import { createClient } from "@supabase/supabase-js";

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: nonUsd } = await admin
    .from("ilas_funds")
    .select("id, fund_code, currency, name_en")
    .neq("currency", "USD");
  const nonUsdIds = new Set((nonUsd || []).map((f) => f.id));
  const nonUsdInfo = new Map((nonUsd || []).map((f) => [f.id, `${f.fund_code}/${f.currency}`]));
  console.log(`non-USD fund ids: ${nonUsdIds.size}`);

  // ilas_reference_portfolio — the "proposed allocation" used by rebalancer
  const { data: refPortfolio } = await admin
    .from("ilas_reference_portfolio")
    .select("fund_id, weight, note");
  const refNonUsd = (refPortfolio || []).filter((r) => nonUsdIds.has(r.fund_id));
  console.log(`\nilas_reference_portfolio: ${(refPortfolio || []).length} rows, ${refNonUsd.length} non-USD:`);
  for (const r of refNonUsd) console.log(`  ${nonUsdInfo.get(r.fund_id)} weight=${r.weight}% note=${r.note ?? ""}`);

  // ilas_portfolio_orders — allocations stored as JSONB; inspect any row
  const { data: orders } = await admin
    .from("ilas_portfolio_orders")
    .select("id, status, old_allocation, new_allocation, decision_date");
  console.log(`\nilas_portfolio_orders: ${(orders || []).length} rows`);
  let nonUsdOrders = 0;
  for (const o of orders || []) {
    const oldAlloc = (o.old_allocation ?? {}) as Record<string, unknown>;
    const newAlloc = (o.new_allocation ?? {}) as Record<string, unknown>;
    const allFundIds = [...Object.keys(oldAlloc), ...Object.keys(newAlloc)];
    const nonUsdInOrder = allFundIds.filter((fid) => nonUsdIds.has(fid));
    if (nonUsdInOrder.length) {
      nonUsdOrders++;
      console.log(`  order ${o.id} (${o.status}, ${o.decision_date}) references non-USD: ${nonUsdInOrder.map((id) => nonUsdInfo.get(id)).join(", ")}`);
    }
  }
  console.log(`  total orders referencing non-USD: ${nonUsdOrders}`);

  // ilas_portfolio_transactions
  const { data: txs, error: txErr } = await admin
    .from("ilas_portfolio_transactions")
    .select("fund_id, portfolio_type, action, status");
  if (txErr) console.log("  ilas_portfolio_transactions:", txErr.message);
  else {
    const txNonUsd = (txs || []).filter((t) => nonUsdIds.has(t.fund_id));
    console.log(`\nilas_portfolio_transactions: ${(txs || []).length} rows, ${txNonUsd.length} non-USD`);
    for (const t of txNonUsd.slice(0, 10))
      console.log(`  ${nonUsdInfo.get(t.fund_id)} ${t.portfolio_type}/${t.action}/${t.status}`);
  }
}
main();
