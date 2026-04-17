/**
 * Scan for orphaned auth.users — rows that have NO corresponding profiles row.
 * Read-only. No mutations.
 *
 * Run: npx tsx --env-file=.env.local scripts/scan-orphans.ts
 */
import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function listAllAuthUsers() {
  const all: { id: string; email: string | undefined; created_at: string; confirmed: string | null | undefined; last_sign_in: string | null | undefined }[] = [];
  let page = 1;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    all.push(
      ...data.users.map((u) => ({
        id: u.id,
        email: u.email,
        created_at: u.created_at,
        confirmed: u.email_confirmed_at,
        last_sign_in: u.last_sign_in_at,
      }))
    );
    if (data.users.length < 200) break;
    page++;
  }
  return all;
}

async function listAllProfiles() {
  const { data, error } = await admin.from("profiles").select("id, email, role, is_active, created_at");
  if (error) throw error;
  return data ?? [];
}

async function main() {
  const [authUsers, profiles] = await Promise.all([listAllAuthUsers(), listAllProfiles()]);
  const profileIds = new Set(profiles.map((p) => p.id));
  const profileEmails = new Set(profiles.map((p) => p.email?.toLowerCase()));

  const orphans = authUsers.filter((u) => !profileIds.has(u.id));
  const profilesWithoutAuth = profiles.filter((p) => !authUsers.find((u) => u.id === p.id));

  console.log(`\n═══ ORPHAN SCAN ═══`);
  console.log(`auth.users total: ${authUsers.length}`);
  console.log(`profiles total:   ${profiles.length}`);
  console.log(`\n[A] Auth users WITHOUT profile row (dashboard-invisible): ${orphans.length}`);
  for (const o of orphans) {
    console.log(`    • ${o.email}  id=${o.id}  created=${o.created_at}  last_sign_in=${o.last_sign_in ?? "never"}  confirmed=${o.confirmed ?? "NO"}`);
  }
  console.log(`\n[B] Profiles WITHOUT auth user (zombie rows): ${profilesWithoutAuth.length}`);
  for (const p of profilesWithoutAuth) {
    console.log(`    • ${p.email}  id=${p.id}  role=${p.role}  is_active=${p.is_active}`);
  }

  // Email collision check (same email in auth but different id than profile)
  const collisions: Array<{ email: string; auth_id: string; profile_id: string }> = [];
  for (const u of authUsers) {
    if (!u.email) continue;
    const match = profiles.find((p) => p.email?.toLowerCase() === u.email!.toLowerCase());
    if (match && match.id !== u.id) {
      collisions.push({ email: u.email, auth_id: u.id, profile_id: match.id });
    }
  }
  console.log(`\n[C] Email collisions (same email, different IDs): ${collisions.length}`);
  for (const c of collisions) console.log(`    •`, c);

  console.log(`\n═══ SUMMARY ═══`);
  console.log(`Orphans (need repair): ${orphans.length}`);
  console.log(`Zombies (profile w/o auth): ${profilesWithoutAuth.length}`);
  console.log(`Collisions: ${collisions.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(99);
});
