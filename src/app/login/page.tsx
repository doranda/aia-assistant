"use client";

import { Suspense } from "react";
import { LoginForm } from "@/components/auth/login-form";
import { LanguageProvider, useLanguage } from "@/lib/i18n";

function LoginContent() {
  const { locale, setLocale, t } = useLanguage();

  return (
    <main className="min-h-dvh flex items-center justify-center px-6">
      {/* Background glow */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[500px] bg-[radial-gradient(ellipse,rgba(196,18,48,0.12)_0%,rgba(196,18,48,0.04)_40%,transparent_70%)] blur-[60px]" />
      </div>

      {/* Language toggle */}
      <div className="fixed top-4 right-4 z-10">
        <button
          onClick={() => setLocale(locale === "en" ? "zh" : "en")}
          className="text-[11px] font-medium text-gray-9 hover:text-gray-11 transition-colors px-2 py-1 rounded bg-white/5 hover:bg-white/10"
        >
          {locale === "en" ? t("lang.zh") : t("lang.en")}
        </button>
      </div>

      <div className="relative w-full max-w-[380px] space-y-8">
        {/* Logo */}
        <div className="text-center space-y-4">
          <div className="mx-auto w-10 h-10 rounded-lg bg-gradient-to-br from-ruby-9 to-ruby-10 shadow-[0_0_20px_rgba(196,18,48,0.3)]" role="img" aria-label={t("login.logoAlt")} />
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-12">
              {t("login.heading")}
            </h1>
            <p className="text-sm text-gray-9 mt-1">
              {t("login.subtitle")}
            </p>
          </div>
        </div>

        <Suspense fallback={<div className="space-y-6 animate-pulse">
          <div className="space-y-2"><div className="h-4 w-12 rounded bg-white/5" /><div className="h-12 rounded-xl bg-white/5" /></div>
          <div className="space-y-2"><div className="h-4 w-16 rounded bg-white/5" /><div className="h-12 rounded-xl bg-white/5" /></div>
          <div className="h-12 rounded-full bg-white/5" />
        </div>}>
          <LoginForm />
        </Suspense>

        <p className="text-center text-xs text-gray-8">
          {t("login.contactAdmin")}
        </p>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <LanguageProvider>
      <LoginContent />
    </LanguageProvider>
  );
}
