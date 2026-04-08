import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canApproveDeletions } from "@/lib/permissions";
import { TopNav } from "@/components/nav/top-nav";
import { MobileNav } from "@/components/nav/mobile-nav";
import { LanguageProvider } from "@/lib/i18n";
import type { UserRole } from "@/lib/types";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const name = user.user_metadata?.full_name || user.email || "";
  const initials = name
    .split(/[\s@]/)
    .slice(0, 2)
    .map((s: string) => s[0]?.toUpperCase() || "")
    .join("");

  // Check pending delete requests for admin/manager badge
  let pendingCount = 0;
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profileError) console.error("[layout] Failed to fetch profile:", profileError);

  const role = (profile?.role || "agent") as UserRole;
  if (canApproveDeletions(role)) {
    const { count, error: deleteError } = await supabase
      .from("delete_requests")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending");
    if (deleteError) console.error("[layout] Failed to fetch delete requests:", deleteError);
    pendingCount = count || 0;
  }

  // Check if MPF pipeline is healthy (successful scraper run in last 12h = green dot)
  const { count: mpfAlertCount, error: scraperError } = await supabase
    .from("scraper_runs")
    .select("*", { count: "exact", head: true })
    .eq("status", "success")
    .gte("run_at", new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString());
  if (scraperError) console.error("[layout] Failed to fetch scraper runs:", scraperError);

  // Pending emergency approvals — only admins can act, so only count for admins
  let approvalsCount = 0;
  if (role === "admin") {
    const { count: mpfAwait, error: mpfAwaitErr } = await supabase
      .from("mpf_pending_switches")
      .select("*", { count: "exact", head: true })
      .eq("status", "awaiting_approval");
    if (mpfAwaitErr) console.error("[layout] Failed to fetch mpf awaiting approvals:", mpfAwaitErr);

    const { count: ilasAwait, error: ilasAwaitErr } = await supabase
      .from("ilas_portfolio_orders")
      .select("*", { count: "exact", head: true })
      .eq("status", "awaiting_approval");
    if (ilasAwaitErr) console.error("[layout] Failed to fetch ilas awaiting approvals:", ilasAwaitErr);

    approvalsCount = (mpfAwait || 0) + (ilasAwait || 0);
  }

  return (
    <LanguageProvider>
      <TopNav
        userInitials={initials || "?"}
        pendingCount={pendingCount}
        mpfAlertCount={mpfAlertCount || 0}
        approvalsCount={approvalsCount}
      />
      <div className="pt-12 pb-20 lg:pb-0 min-h-dvh">{children}</div>
      <MobileNav approvalsCount={approvalsCount} />
    </LanguageProvider>
  );
}
