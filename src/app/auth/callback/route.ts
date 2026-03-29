import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { isSafeRedirect } from "@/lib/safe-redirect";
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const redirect = searchParams.get("redirect");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error("[auth/callback] Code exchange failed:", error.message);
      return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
    }
  }

  const destination = isSafeRedirect(redirect) ? redirect : "/dashboard";

  return NextResponse.redirect(`${origin}${destination}`);
}
