import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canApproveDeletions } from "@/lib/permissions";
import { TopNav } from "@/components/nav/top-nav";
import { MobileNav } from "@/components/nav/mobile-nav";
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
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const role = (profile?.role || "agent") as UserRole;
  if (canApproveDeletions(role)) {
    const { count } = await supabase
      .from("delete_requests")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending");
    pendingCount = count || 0;
  }

  // Check for new MPF insights (generated in last 24h)
  const { count: mpfAlertCount } = await supabase
    .from("mpf_insights")
    .select("*", { count: "exact", head: true })
    .eq("status", "completed")
    .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

  return (
    <>
      <TopNav
        userInitials={initials || "?"}
        pendingCount={pendingCount}
        mpfAlertCount={mpfAlertCount || 0}
      />
      <div className="pt-12 pb-20 lg:pb-0 min-h-dvh">{children}</div>
      <MobileNav pendingCount={pendingCount} />
    </>
  );
}
