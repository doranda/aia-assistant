/**
 * Diagnose + repair a teammate's account by email.
 * - Finds auth user
 * - Resets password + confirms email
 * - Ensures a profile row exists (does NOT clobber existing role/full_name)
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/repair-user.ts <email> <password> [full_name]
 */
import { createClient } from "@supabase/supabase-js";

const EMAIL = process.argv[2];
const PASSWORD = process.argv[3];
const FALLBACK_NAME = process.argv[4];

if (!EMAIL || !PASSWORD) {
  console.error("Usage: tsx scripts/repair-user.ts <email> <password> [full_name]");
  process.exit(1);
}

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function findAuthUser(email: string) {
  let page = 1;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const m = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (m) return m;
    if (data.users.length < 200) return null;
    page++;
  }
}

function deriveName(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join(" ");
}

async function main() {
  console.log(`\n[1] Lookup auth user: ${EMAIL}`);
  const authUser = await findAuthUser(EMAIL);
  if (!authUser) {
    console.error(`  ✗ No auth user — aborting (won't silently create).`);
    process.exit(2);
  }
  console.log(`  ✓ id=${authUser.id}`);
  console.log(`    email_confirmed_at=${authUser.email_confirmed_at ?? "null"}`);
  console.log(`    last_sign_in_at=${authUser.last_sign_in_at ?? "null"}`);

  console.log(`\n[2] Check profile`);
  const { data: profile, error: pe } = await admin
    .from("profiles")
    .select("id, email, full_name, role, is_active")
    .eq("id", authUser.id)
    .maybeSingle();
  if (pe) {
    console.error("  ✗", pe.message);
    process.exit(3);
  }
  console.log(profile ? { ...profile } : "  ✗ MISSING — dashboard can't see user");

  console.log(`\n[3] Reset password`);
  const { error: pwErr } = await admin.auth.admin.updateUserById(authUser.id, {
    password: PASSWORD,
    email_confirm: true,
  });
  if (pwErr) {
    console.error("  ✗", pwErr.message);
    process.exit(4);
  }
  console.log(`  ✓ password=${PASSWORD}, email_confirm=true`);

  console.log(`\n[4] Ensure profile`);
  const name = FALLBACK_NAME ?? deriveName(EMAIL);
  if (!profile) {
    const { data, error } = await admin
      .from("profiles")
      .insert({
        id: authUser.id,
        email: EMAIL,
        full_name: name,
        role: "agent",
        is_active: true,
      })
      .select()
      .single();
    if (error) {
      console.error("  ✗", error.message);
      process.exit(5);
    }
    console.log("  ✓ inserted", data);
  } else {
    const patch: Record<string, unknown> = {};
    if (profile.is_active === false) patch.is_active = true;
    if (profile.email !== EMAIL) patch.email = EMAIL;
    if (Object.keys(patch).length) {
      const { data, error } = await admin
        .from("profiles")
        .update(patch)
        .eq("id", authUser.id)
        .select()
        .single();
      if (error) {
        console.error("  ✗", error.message);
        process.exit(6);
      }
      console.log("  ✓ patched", patch, "→", data);
    } else {
      console.log("  ✓ profile healthy — no changes");
    }
  }

  const { data: final } = await admin
    .from("profiles")
    .select("id, email, full_name, role, is_active, last_login")
    .eq("id", authUser.id)
    .single();
  console.log(`\n✅ Final state:`, final);
  console.log(`\nLogin: ${EMAIL} / ${PASSWORD}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(99);
});
