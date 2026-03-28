"use client";

import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { LayoutDashboard, MessageSquare, BarChart3, FileText, TrendingUp } from "lucide-react";

const navItems = [
  { label: "Home", href: "/dashboard", icon: LayoutDashboard },
  { label: "MPF", href: "/mpf-care", icon: TrendingUp },
  { label: "ILAS", href: "/ilas-track", icon: BarChart3 },
  { label: "Chat", href: "/chat", icon: MessageSquare },
  { label: "Docs", href: "/documents", icon: FileText },
];

export function MobileNav() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <nav aria-label="Mobile navigation" className="fixed bottom-0 left-0 right-0 z-50 lg:hidden bg-zinc-950/90 backdrop-blur-xl border-t border-zinc-800/60 safe-area-pb">
      <div className="flex items-center justify-around h-16 px-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname.startsWith(item.href);
          return (
            <button
              key={item.href}
              onClick={() => router.push(item.href)}
              className={cn(
                "flex flex-col items-center justify-center gap-1 min-w-[44px] min-h-[44px] w-16 h-full transition-colors cursor-pointer",
                isActive ? "text-[#D71920]" : "text-zinc-600"
              )}
            >
              <span className="relative">
                <Icon className="w-5 h-5" />
              </span>
              <span className="text-[10px] font-semibold">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
