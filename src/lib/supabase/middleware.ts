import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_ROUTES = [
  "/dashboard", "/mpf-care", "/ilas-track", "/chat",
  "/documents", "/faqs", "/team",
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
    return NextResponse.redirect(loginUrl);
  }

  // Prevent caching of authenticated pages — critical for multi-user security
  if (pathname.startsWith('/') && !pathname.startsWith('/api/') && !pathname.startsWith('/_next/')) {
    supabaseResponse.headers.set('Cache-Control', 'private, no-store, no-cache, must-revalidate');
    supabaseResponse.headers.set('Pragma', 'no-cache');
  }

  return supabaseResponse;
}
