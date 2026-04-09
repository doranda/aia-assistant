// src/lib/agents/signal-promoter.ts
// Signal promoter: evaluates pending agent_signals for a user/product pair.
// Called by the reconcile-prices cron after rows are settled.
//
// Rules:
//   - Rejects signals older than 48h (stale)
//   - Rejects signals with payload.confidence < 0.5
//   - Promotes the rest (status → 'promoted', consumed_at → now())

import { createAdminClient } from "@/lib/supabase/admin";
import type { ProductType } from "@/lib/portfolio/state-gate";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STALE_THRESHOLD_MS = 48 * 60 * 60 * 1000; // 48 hours
const MIN_CONFIDENCE = 0.5;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SignalRow {
  id: string;
  emitted_at: string;
  payload: { confidence?: number; [key: string]: unknown };
}

export interface PromoteResult {
  evaluated: number;
  promoted: number;
  rejected: number;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function promoteSignals(
  userId: string,
  productType: ProductType,
): Promise<PromoteResult> {
  const supabase = createAdminClient();
  const now = new Date();

  // Fetch all pending signals for this user + product
  const { data: signals, error } = await supabase
    .from("agent_signals")
    .select("id, emitted_at, payload")
    .eq("user_id", userId)
    .eq("product_type", productType)
    .eq("status", "pending")
    .order("emitted_at", { ascending: true });

  if (error) {
    throw new Error(
      `promoteSignals: failed to fetch signals for ${userId}/${productType}: ${error.message}`,
    );
  }

  const rows = (signals ?? []) as SignalRow[];
  const toPromote: string[] = [];
  const toReject: Array<{ id: string; reason: string }> = [];

  for (const signal of rows) {
    const emittedAt = new Date(signal.emitted_at);
    const ageMs = now.getTime() - emittedAt.getTime();

    // Gate 1: staleness
    if (ageMs > STALE_THRESHOLD_MS) {
      toReject.push({ id: signal.id, reason: "stale_48h" });
      continue;
    }

    // Gate 2: confidence threshold
    const confidence = signal.payload?.confidence ?? 0;
    if (confidence < MIN_CONFIDENCE) {
      toReject.push({
        id: signal.id,
        reason: `low_confidence_${confidence}`,
      });
      continue;
    }

    // Passes all gates
    toPromote.push(signal.id);
  }

  // Batch update: promote
  if (toPromote.length > 0) {
    const { error: promoteErr } = await supabase
      .from("agent_signals")
      .update({
        status: "promoted",
        consumed_at: now.toISOString(),
      })
      .in("id", toPromote);

    if (promoteErr) {
      console.error(
        `[signal-promoter] Promote update failed for ${userId}/${productType}:`,
        promoteErr,
      );
    }
  }

  // Batch update: reject
  if (toReject.length > 0) {
    // Group by reason for efficient updates
    const byReason = new Map<string, string[]>();
    for (const r of toReject) {
      const ids = byReason.get(r.reason) ?? [];
      ids.push(r.id);
      byReason.set(r.reason, ids);
    }

    for (const [reason, ids] of byReason) {
      const { error: rejectErr } = await supabase
        .from("agent_signals")
        .update({
          status: "rejected",
          consumed_at: now.toISOString(),
          rejection_reason: reason,
        })
        .in("id", ids);

      if (rejectErr) {
        console.error(
          `[signal-promoter] Reject update failed for reason=${reason}:`,
          rejectErr,
        );
      }
    }
  }

  return {
    evaluated: rows.length,
    promoted: toPromote.length,
    rejected: toReject.length,
  };
}
