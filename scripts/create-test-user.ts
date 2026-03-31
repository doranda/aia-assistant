/**
 * Create a test user for E2E tests.
 * Run: npx tsx scripts/create-test-user.ts
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local
 * Idempotent — safe to run multiple times.
 */

import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.");
  console.error("Run: source .env.local (or load via dotenv)");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TEST_EMAIL = "e2e-test@aia-assistant.local";
const TEST_PASSWORD = crypto.randomBytes(18).toString("base64url"); // 24 chars

async function main() {
  // Check if user already exists
  const { data: existing } = await supabase.auth.admin.listUsers();
  const existingUser = existing?.users?.find((u) => u.email === TEST_EMAIL);

  let userId: string;

  if (existingUser) {
    console.log(`Test user already exists: ${TEST_EMAIL} (${existingUser.id})`);
    // Update password so we know the current one
    const { error } = await supabase.auth.admin.updateUserById(existingUser.id, {
      password: TEST_PASSWORD,
    });
    if (error) {
      console.error("Failed to update password:", error.message);
      process.exit(1);
    }
    userId = existingUser.id;
    console.log("Password updated.");
  } else {
    // Create new user
    const { data, error } = await supabase.auth.admin.createUser({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (error) {
      console.error("Failed to create user:", error.message);
      process.exit(1);
    }
    userId = data.user.id;
    console.log(`Created test user: ${TEST_EMAIL} (${userId})`);
  }

  // Upsert profile with admin role
  const { error: profileError } = await supabase
    .from("profiles")
    .upsert(
      { id: userId, email: TEST_EMAIL, full_name: "E2E Test Admin", role: "admin" },
      { onConflict: "id" }
    );

  if (profileError) {
    console.error("Failed to upsert profile:", profileError.message);
    process.exit(1);
  }

  console.log("\n--- Add these to .env.local ---");
  console.log(`TEST_USER_EMAIL=${TEST_EMAIL}`);
  console.log(`TEST_USER_PASSWORD=${TEST_PASSWORD}`);
  console.log("-------------------------------\n");
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
