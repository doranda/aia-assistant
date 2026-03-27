// src/components/mpf/disclaimer-banner.tsx
import { INSIGHT_DISCLAIMER } from "@/lib/mpf/constants";

export function DisclaimerBanner({ lang = "en" }: { lang?: "en" | "zh" }) {
  return (
    <aside
      role="note"
      aria-label="Disclaimer"
      className="text-[11px] text-zinc-400 font-mono border border-zinc-800/40 rounded-md px-4 py-2.5"
    >
      {lang === "zh" ? INSIGHT_DISCLAIMER.zh : INSIGHT_DISCLAIMER.en}
    </aside>
  );
}
