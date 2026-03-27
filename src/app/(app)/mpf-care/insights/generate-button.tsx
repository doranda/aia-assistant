"use client";

import { useState, useRef } from "react";

export function GenerateInsightButton() {
  const [status, setStatus] = useState<"idle" | "generating" | "done" | "error">("idle");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function handleGenerate() {
    setStatus("generating");

    try {
      const res = await fetch("/api/mpf/insights", { method: "POST" });
      if (!res.ok) throw new Error("Failed");

      const { id } = await res.json();

      // Poll for completion
      pollRef.current = setInterval(async () => {
        const check = await fetch(`/api/mpf/insights/${id}`);
        const data = await check.json();
        if (data.status === "completed") {
          if (pollRef.current) clearInterval(pollRef.current);
          setStatus("done");
          window.location.reload();
        } else if (data.status === "failed") {
          if (pollRef.current) clearInterval(pollRef.current);
          setStatus("error");
        }
      }, 3000);

      // Timeout after 3 minutes
      setTimeout(() => {
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
        // Use functional update to read current status without stale closure
        setStatus((prev) => (prev === "generating" ? "error" : prev));
      }, 180_000);
    } catch {
      setStatus("error");
    }
  }

  return (
    <button
      onClick={handleGenerate}
      disabled={status === "generating"}
      className="text-[12px] font-medium px-4 py-2 rounded-md bg-[#D71920] text-white hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
    >
      {status === "generating" ? "Generating…" :
       status === "done" ? "Done!" :
       status === "error" ? "Failed — Retry" :
       "Generate Fresh Insight"}
    </button>
  );
}
