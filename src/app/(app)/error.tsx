"use client";

import { useEffect } from "react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app error boundary]", error);
  }, [error]);

  return (
    <main className="flex flex-col items-center justify-center min-h-[60vh] gap-4 px-6">
      <h1 className="text-xl font-semibold text-zinc-100">Something went wrong</h1>
      <p className="text-sm text-zinc-400 max-w-md text-center">
        An unexpected error occurred. Please try again or contact your administrator if the problem persists.
      </p>
      <button
        onClick={reset}
        className="mt-2 px-4 py-2 min-h-[44px] rounded-md bg-zinc-800 text-zinc-100 text-sm hover:bg-zinc-700 transition-colors"
      >
        Try again
      </button>
    </main>
  );
}
