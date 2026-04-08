"use client";

import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/lib/i18n";
import { LayoutDashboard, MessageSquare, BarChart3, FileText, TrendingUp, BookOpen, Users, BellRing } from "lucide-react";

export function MobileNav({ approvalsCount = 0 }: { approvalsCount?: number } = {}) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useLanguage();

  const navItemDefs = [
    { labelKey: "mobileNav.home" as const, href: "/dashboard", icon: LayoutDashboard },
    { labelKey: "mobileNav.mpf" as const, href: "/mpf-care", icon: TrendingUp },
    { labelKey: "mobileNav.ilas" as const, href: "/ilas-track", icon: BarChart3 },
    { labelKey: "mobileNav.chat" as const, href: "/chat", icon: MessageSquare },
    { labelKey: "mobileNav.docs" as const, href: "/documents", icon: FileText },
    { labelKey: "mobileNav.faqs" as const, href: "/faqs", icon: BookOpen },
    { labelKey: "mobileNav.team" as const, href: "/team", icon: Users },
    { labelKey: "mobileNav.approvals" as const, href: "/approvals", icon: BellRing },
  ];

  return (
    <nav aria-label={t("nav.mobileNavigation")} className="fixed bottom-0 left-0 right-0 z-50 lg:hidden bg-zinc-950/90 backdrop-blur-xl border-t border-zinc-800/60 safe-area-pb">
      <div className="flex items-center justify-around h-16 px-2">
        {navItemDefs.map((item) => {
          const Icon = item.icon;
          const isActive = pathname.startsWith(item.href);
          return (
            <button
              key={item.href}
              onClick={() => router.push(item.href)}
              className={cn(
                "flex flex-col items-center justify-center gap-1 min-w-[44px] min-h-[44px] flex-1 h-full transition-colors cursor-pointer",
                isActive ? "text-[#D71920]" : "text-zinc-600"
              )}
            >
              <span className="relative">
                <Icon className="w-5 h-5" />
                {item.labelKey === "mobileNav.approvals" && approvalsCount > 0 && (
                  <span className="absolute -top-1 -right-2 inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-red-600 text-[9px] font-bold text-white">
                    {approvalsCount}
                  </span>
                )}
              </span>
              <span className="text-[10px] font-semibold">{t(item.labelKey)}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
