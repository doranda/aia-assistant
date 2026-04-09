// src/components/ui/switch-status-badge.tsx
// Unified status badge for MPF switch / ILAS order lifecycle.
//
// States: pending → awaiting_approval → executed → settled
// The "executed" state is the optimistic settlement phase where the switch
// is committed but NAV reconciliation is pending (~4-6 biz days).

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type SwitchStatus =
  | "pending"
  | "awaiting_approval"
  | "executed"
  | "settled"
  | "expired"
  | "rejected";

const STATUS_CONFIG: Record<
  SwitchStatus,
  { label: string; className: string; hint?: string }
> = {
  pending: {
    label: "Pending",
    className: "bg-yellow-500/15 text-yellow-300 border-yellow-500/30",
  },
  awaiting_approval: {
    label: "Awaiting Approval",
    className: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  },
  executed: {
    label: "Executed",
    className: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    hint: "Awaiting NAV reconciliation — typical 4-6 biz days",
  },
  settled: {
    label: "Settled",
    className: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  },
  expired: {
    label: "Expired",
    className: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
  },
  rejected: {
    label: "Rejected",
    className: "bg-red-500/15 text-red-300 border-red-500/30",
  },
};

interface SwitchStatusBadgeProps {
  status: string;
  showHint?: boolean;
  className?: string;
}

export function SwitchStatusBadge({
  status,
  showHint = false,
  className,
}: SwitchStatusBadgeProps) {
  const config = STATUS_CONFIG[status as SwitchStatus] ?? {
    label: status,
    className: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
  };

  return (
    <span className={cn("inline-flex flex-col gap-0.5", className)}>
      <Badge
        variant="outline"
        className={cn("text-[10px] font-medium", config.className)}
      >
        {config.label}
      </Badge>
      {showHint && config.hint && (
        <span className="text-[10px] text-zinc-500 leading-tight">
          {config.hint}
        </span>
      )}
    </span>
  );
}

/**
 * Format a NAV total for display. Returns em-dash for null/undefined/zero values
 * that indicate NAV hasn't been reconciled yet.
 */
export function formatNavTotal(value: number | null | undefined): string {
  if (value === null || value === undefined) return "\u2014";
  if (value === 0) return "\u2014";
  return value.toFixed(4);
}
