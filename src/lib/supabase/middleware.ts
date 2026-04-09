import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_ROUTES = [
  "/dashboard", "/mpf-care", "/ilas-track", "/chat",
  "/documents", "/faqs", "/team", "/approvals",
  "/api/mpf/rebalance-history",
];

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options));
        },
      },
    }
  );
  const { data: { user } } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isProtected = PROTECTED_ROUTES.some((route) => pathname.startsWith(route));

  if (isProtected && !user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("redirect", pathname);
    const redirectResponse = NextResponse.redirect(loginUrl);
    // Redirects are NEW response objects — re-apply no-store + security headers
    // so intermediate proxies don't cache per-user redirects and the redirect
    // itself can't be framed or sniffed.
    redirectResponse.headers.set("Cache-Control", "private, no-store, no-cache, must-revalidate");
    redirectResponse.headers.set("Pragma", "no-cache");
    redirectResponse.headers.set("X-Frame-Options", "DENY");
    redirectResponse.headers.set("X-Content-Type-Options", "nosniff");
    redirectResponse.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    return redirectResponse;
  }

  // Prevent caching of authenticated pages — critical for multi-user security
  if (pathname.startsWith('/') && !pathname.startsWith('/api/') && !pathname.startsWith('/_next/')) {
    supabaseResponse.headers.set('Cache-Control', 'private, no-store, no-cache, must-revalidate');
    supabaseResponse.headers.set('Pragma', 'no-cache');
  }

  // Security headers
  supabaseResponse.headers.set('X-Frame-Options', 'DENY');
  supabaseResponse.headers.set('X-Content-Type-Options', 'nosniff');
  supabaseResponse.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  supabaseResponse.headers.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://*.supabase.co https://ai-gateway.vercel.sh wss://*.supabase.co; frame-ancestors 'none';"
  );

  return supabaseResponse;
}
