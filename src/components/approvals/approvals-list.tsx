"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export interface PendingItem {
  id: string;
  engine: "mpf" | "ilas";
  portfolioLabel: string;
  isEmergency: boolean;
  decisionDate: string;
  expiresAt: string | null;
  oldAllocation: unknown;
  newAllocation: unknown;
  createdAt: string;
}

interface FundLeg {
  code?: string;
  fund_code?: string;
  weight: number;
}

function formatAllocation(raw: unknown): string {
  if (!Array.isArray(raw)) return "—";
  const legs = raw as FundLeg[];
  return legs
    .filter((l) => l.weight > 0)
    .map((l) => `${l.code || l.fund_code || "?"} ${l.weight}%`)
    .join("  ·  ");
}

function timeUntil(iso: string | null): string {
  if (!iso) return "no expiry";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "EXPIRED";
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const mins = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) return `${hours}h ${mins}m left`;
  return `${mins}m left`;
}

export function ApprovalsList({ items }: { items: PendingItem[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Tick every 30s so the expiry countdown updates live (not just on page reload)
  const [, setTick] = useState(0);
  useEffect(() => {
    if (items.length === 0) return;
    const interval = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(interval);
  }, [items.length]);

  async function handleApprove(item: PendingItem) {
    setError(null);
    setSuccess(null);
    setBusyId(item.id);

    const url =
      item.engine === "mpf"
        ? "/api/mpf/approve-switch"
        : "/api/ilas/approve-switch";
    // Token is resolved server-side from admin session — never sent from client
    const body =
      item.engine === "mpf"
        ? { switch_id: item.id }
        : { order_id: item.id };

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Approval failed");
        setBusyId(null);
        return;
      }
      setSuccess(json.message || "Approved");
      startTransition(() => {
        router.refresh();
      });
      setBusyId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      setBusyId(null);
    }
  }

  if (items.length === 0) {
    return (
      <section className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-8 text-center">
        <p className="text-sm text-zinc-400">No pending approvals.</p>
        <p className="text-xs text-zinc-500 mt-1">
          Emergency switch requests will appear here when the rebalancer flags one.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      {error && (
        <div role="alert" className="rounded-md border border-red-900/40 bg-red-950/30 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}
      {success && (
        <div role="status" className="rounded-md border border-emerald-900/40 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200">
          {success}
        </div>
      )}

      {items.map((item) => {
        const expiry = timeUntil(item.expiresAt);
        const isExpired = expiry === "EXPIRED";
        const isBusy = busyId === item.id || pending;

        return (
          <article
            key={`${item.engine}-${item.id}`}
            className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-5 sm:p-6"
          >
            <header className="flex items-start justify-between gap-3 mb-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {item.isEmergency && (
                    <Badge variant="destructive" className="text-[10px]">
                      🚨 EMERGENCY
                    </Badge>
                  )}
                  <h2 className="text-base font-semibold text-zinc-100 truncate">
                    {item.portfolioLabel}
                  </h2>
                </div>
                <p className="text-xs text-zinc-500 mt-1 font-mono truncate">
                  {item.id}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className={`text-xs font-medium ${isExpired ? "text-red-400" : "text-amber-400"}`}>
                  {expiry}
                </p>
                <p className="text-[10px] text-zinc-500 mt-0.5">decided {item.decisionDate}</p>
              </div>
            </header>

            <dl className="space-y-3 mb-5 text-sm">
              <div>
                <dt className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1">Current</dt>
                <dd className="text-zinc-300 font-mono text-xs leading-relaxed break-words">
                  {formatAllocation(item.oldAllocation)}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1">Proposed</dt>
                <dd className="text-emerald-300 font-mono text-xs leading-relaxed break-words">
                  {formatAllocation(item.newAllocation)}
                </dd>
              </div>
            </dl>

            <div className="flex gap-2">
              <Button
                onClick={() => handleApprove(item)}
                disabled={isBusy || isExpired}
                className="flex-1 sm:flex-none min-h-11"
              >
                {isBusy ? "Approving…" : isExpired ? "Expired" : "Approve"}
              </Button>
              <Button
                variant="outline"
                disabled
                className="flex-1 sm:flex-none min-h-11"
                title="Letting it expire = reject. Closes in 48h automatically."
              >
                Let expire
              </Button>
            </div>
          </article>
        );
      })}
    </section>
  );
}
