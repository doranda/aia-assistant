"use client";

// Shared banner: shows "Prices as of [date]" with a warning if data is stale (>3 business days)
import { cn } from "@/lib/utils";
import { Clock, AlertTriangle } from "lucide-react";
import { useLanguage } from "@/lib/i18n";

interface PriceFreshnessBannerProps {
  priceDate: string; // ISO date string e.g. "2026-03-27"
  label?: string;    // e.g. "MPF" or "ILAS"
}

/** Count business days (Mon-Fri) between two dates, excluding both endpoints */
function businessDaysBetween(from: Date, to: Date): number {
  let count = 0;
  const current = new Date(from);
  current.setDate(current.getDate() + 1);
  while (current < to) {
    const day = current.getDay();
    if (day !== 0 && day !== 6) count++;
    current.setDate(current.getDate() + 1);
  }
  return count;
}

export function PriceFreshnessBanner({ priceDate, label }: PriceFreshnessBannerProps) {
  const { t } = useLanguage();

  const priceD = new Date(priceDate + "T00:00:00");
  const now = new Date();
  const today = new Date(now.toISOString().split("T")[0] + "T00:00:00");
  const staleDays = businessDaysBetween(priceD, today);
  const isStale = staleDays > 3;

  const formattedDate = priceD.toLocaleDateString("en-HK", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const pricesLabel = label ? `${label} ${t("shared.prices").toLowerCase()}` : t("shared.prices");

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-md text-[12px] font-medium",
        isStale
          ? "bg-amber-950/40 border border-amber-800/50 text-amber-300"
          : "bg-zinc-800/40 border border-zinc-700/30 text-zinc-400"
      )}
      role={isStale ? "alert" : "status"}
    >
      {isStale ? (
        <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400" />
      ) : (
        <Clock className="w-3.5 h-3.5 shrink-0" />
      )}
      <span>
        {pricesLabel} {t("shared.asOf")} <strong className="text-zinc-200">{formattedDate}</strong>
        {isStale
          ? ` — ${staleDays} ${t("shared.staleWarning")}`
          : ` — ${t("shared.lagInfo")}`}
      </span>
    </div>
  );
}
