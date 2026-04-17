import { createClient } from "@supabase/supabase-js";

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  const { data, error } = await admin
    .from("ilas_funds")
    .select("fund_code, name_en, currency, category, is_active, is_distribution");
  if (error) {
    console.error(error);
    process.exit(1);
  }
  const counts: Record<string, number> = {};
  for (const r of data) counts[r.currency ?? "NULL"] = (counts[r.currency ?? "NULL"] || 0) + 1;
  console.log("ilas_funds total rows:", data.length);
  console.log("currency distribution:", counts);
  console.log("\nNon-US$ funds:");
  for (const r of data.filter((f) => f.currency !== "US$")) {
    console.log(`  ${r.fund_code} | ${r.currency} | ${r.category} | dist=${r.is_distribution} | active=${r.is_active} | ${r.name_en}`);
  }
}
main();
