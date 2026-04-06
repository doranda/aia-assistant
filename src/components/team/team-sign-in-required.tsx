"use client";

import { useLanguage } from "@/lib/i18n";

export function TeamSignInRequired() {
  const { t } = useLanguage();
  return (
    <div className="max-w-[980px] mx-auto px-6 py-16">
      <p className="text-gray-8">{t("team.signInRequired")}</p>
    </div>
  );
}
