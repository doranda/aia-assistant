"use client";

import { useLanguage } from "@/lib/i18n";
import { FAQManager } from "./faq-manager";
import { TrendingQuestions } from "./trending-questions";

export default function Page() {
  const { t } = useLanguage();

  return (
    <main className="max-w-[980px] mx-auto px-6 py-16 lg:py-24">
      <div className="mb-12">
        <h1 className="text-4xl font-extrabold tracking-tight bg-gradient-to-b from-[#f5f5f7] to-white/70 bg-clip-text text-transparent">
          {t("faqs.heading")}
        </h1>
        <p className="text-gray-8 text-sm mt-2">
          {t("faqs.subtitle")}
        </p>
      </div>

      <FAQManager />

      <TrendingQuestions />
    </main>
  );
}
