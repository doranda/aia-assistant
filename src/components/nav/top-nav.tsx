"use client";

import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { LayoutDashboard, MessageSquare, BarChart3, FileText, BookOpen, Users, TrendingUp } from "lucide-react";

const navItems = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "MPF Care", href: "/mpf-care", icon: TrendingUp },
  { label: "ILAS Track", href: "/ilas-track", icon: BarChart3 },
  { label: "Chat", href: "/chat", icon: MessageSquare },
  { label: "Documents", href: "/documents", icon: FileText },
  { label: "FAQs", href: "/faqs", icon: BookOpen },
  { label: "Team", href: "/team", icon: Users },
];

export function TopNav({ userInitials, pendingCount = 0, mpfAlertCount = 0 }: { userInitials: string; pendingCount?: number; mpfAlertCount?: number }) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <nav aria-label="Main navigation" className="fixed top-0 left-0 right-0 z-50 h-12 hidden lg:flex items-center justify-between px-6 xl:px-[max(24px,calc((100vw-980px)/2))] bg-zinc-950/80 backdrop-blur-xl backdrop-saturate-[180%] border-b border-zinc-800/60">
      <div className="flex items-center gap-8">
        <button onClick={() => router.push("/dashboard")} className="flex items-center gap-2.5 cursor-pointer">
          <div className="w-5 h-5 rounded-[5px] bg-[#D71920]" />
          <span className="text-[13px] font-semibold text-zinc-50 tracking-[-0.01em]">
            Knowledge Hub
          </span>
        </button>

        <div className="flex gap-0.5" role="tablist">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname.startsWith(item.href);
            return (
              <button
                key={item.href}
                role="tab"
                aria-selected={isActive}
                onClick={() => router.push(item.href)}
                className={cn(
                  "flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-md transition-colors cursor-pointer",
                  isActive
                    ? "text-zinc-50 bg-zinc-800/80"
                    : "text-zinc-500 hover:text-zinc-300"
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {item.label}
                {item.label === "Team" && pendingCount > 0 && (
                  <span className="ml-0.5 w-1.5 h-1.5 rounded-full bg-amber-500" />
                )}
                {item.label === "MPF Care" && mpfAlertCount > 0 && (
                  <span className="ml-0.5 w-1.5 h-1.5 rounded-full bg-emerald-500" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" aria-label="System online" />
        <button
          onClick={handleSignOut}
          className="w-10 h-10 rounded-md bg-zinc-800 border border-zinc-700 flex items-center justify-center text-[10px] font-semibold text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors cursor-pointer"
          aria-label="Sign out"
        >
          {userInitials}
        </button>
      </div>
    </nav>
  );
}
