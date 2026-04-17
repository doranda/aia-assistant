/**
 * Find auth users by email substring.
 * Run: npx tsx --env-file=.env.local scripts/find-user.ts <substring>
 */
import { createClient } from "@supabase/supabase-js";

const q = (process.argv[2] || "").toLowerCase();
if (!q) {
  console.error("Usage: tsx scripts/find-user.ts <substring>");
  process.exit(1);
}

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function main() {
  let page = 1;
  const matches: { id: string; email: string | undefined; confirmed: string | null | undefined; last_sign_in: string | null | undefined; created: string }[] = [];
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    for (const u of data.users) {
      if (u.email?.toLowerCase().includes(q)) {
        matches.push({
          id: u.id,
          email: u.email,
          confirmed: u.email_confirmed_at,
          last_sign_in: u.last_sign_in_at,
          created: u.created_at,
        });
      }
    }
    if (data.users.length < 200) break;
    page++;
  }

  if (!matches.length) {
    console.log(`No auth users matching "${q}"`);
    return;
  }

  for (const m of matches) {
    const { data: prof } = await admin
      .from("profiles")
      .select("id, role, is_active, full_name")
      .eq("id", m.id)
      .maybeSingle();
    console.log({
      ...m,
      profile: prof ?? "MISSING",
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(99);
});
