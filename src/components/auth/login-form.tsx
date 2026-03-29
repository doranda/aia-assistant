"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { isSafeRedirect } from "@/lib/safe-redirect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect");
  const destination = isSafeRedirect(redirectTo) ? redirectTo : "/dashboard";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    router.push(destination);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="email" className="text-sm font-medium text-gray-11">
          Email
        </Label>
        <Input
          id="email"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
          className="h-12 bg-white/5 border-white/8 text-gray-12 placeholder:text-gray-8 rounded-xl"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password" className="text-sm font-medium text-gray-11">
          Password
        </Label>
        <Input
          id="password"
          type="password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          autoComplete="current-password"
          className="h-12 bg-white/5 border-white/8 text-gray-12 placeholder:text-gray-8 rounded-xl"
        />
      </div>
      {error && (
        <p className="text-sm text-ruby-11 bg-ruby-3/50 px-4 py-3 rounded-lg">
          {error}
        </p>
      )}
      <Button
        type="submit"
        disabled={loading}
        className="w-full h-12 rounded-full bg-gradient-to-br from-ruby-9 to-ruby-10 hover:shadow-[0_0_30px_rgba(196,18,48,0.35)] text-white font-bold transition-all"
      >
        {loading ? "Signing in..." : "Sign in"}
      </Button>
    </form>
  );
}
