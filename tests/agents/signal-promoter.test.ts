// tests/agents/signal-promoter.test.ts
// Unit tests for the signal promoter with mocked Supabase.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock Supabase
// ---------------------------------------------------------------------------

const mockUpdate = vi.fn().mockReturnValue({ error: null });
const mockIn = vi.fn().mockReturnValue({ error: null });
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockOrder = vi.fn();

// Chain builder: .from().select().eq().eq().eq().order()
function buildChain(data: unknown[], error: unknown = null) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnValue({ data, error }),
    update: vi.fn().mockReturnValue({
      in: vi.fn().mockReturnValue({ error: null }),
    }),
  };
  return chain;
}

let fromChain: ReturnType<typeof buildChain>;

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === "agent_signals") return fromChain;
      return buildChain([]);
    }),
  })),
}));

// Import AFTER mocks are set up
const { promoteSignals } = await import("@/lib/agents/signal-promoter");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSignal(
  id: string,
  ageHours: number,
  confidence: number,
): { id: string; emitted_at: string; payload: { confidence: number } } {
  const emitted = new Date(Date.now() - ageHours * 60 * 60 * 1000);
  return {
    id,
    emitted_at: emitted.toISOString(),
    payload: { confidence },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("promoteSignals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should promote signals with high confidence and recent timestamp", async () => {
    const signals = [
      makeSignal("sig-1", 1, 0.8), // 1h old, high confidence
      makeSignal("sig-2", 12, 0.6), // 12h old, above threshold
    ];

    fromChain = buildChain(signals);
    const result = await promoteSignals("user-1", "mpf");

    expect(result.evaluated).toBe(2);
    expect(result.promoted).toBe(2);
    expect(result.rejected).toBe(0);
  });

  it("should reject signals older than 48h", async () => {
    const signals = [
      makeSignal("sig-old", 50, 0.9), // 50h old — stale
    ];

    fromChain = buildChain(signals);
    const result = await promoteSignals("user-1", "mpf");

    expect(result.evaluated).toBe(1);
    expect(result.promoted).toBe(0);
    expect(result.rejected).toBe(1);
  });

  it("should reject signals with confidence below 0.5", async () => {
    const signals = [
      makeSignal("sig-low", 1, 0.3), // recent but low confidence
    ];

    fromChain = buildChain(signals);
    const result = await promoteSignals("user-1", "ilas");

    expect(result.evaluated).toBe(1);
    expect(result.promoted).toBe(0);
    expect(result.rejected).toBe(1);
  });

  it("should handle mixed signals — some promoted, some rejected", async () => {
    const signals = [
      makeSignal("sig-good", 2, 0.75), // promote
      makeSignal("sig-stale", 49, 0.9), // reject: stale
      makeSignal("sig-weak", 5, 0.2), // reject: low confidence
      makeSignal("sig-ok", 24, 0.5), // promote: exactly at threshold
    ];

    fromChain = buildChain(signals);
    const result = await promoteSignals("user-1", "mpf");

    expect(result.evaluated).toBe(4);
    expect(result.promoted).toBe(2);
    expect(result.rejected).toBe(2);
  });

  it("should return zeros when no pending signals exist", async () => {
    fromChain = buildChain([]);
    const result = await promoteSignals("user-1", "mpf");

    expect(result.evaluated).toBe(0);
    expect(result.promoted).toBe(0);
    expect(result.rejected).toBe(0);
  });

  it("should handle signals with missing confidence in payload", async () => {
    // confidence is undefined → defaults to 0 → rejected
    const signals = [
      {
        id: "sig-noconf",
        emitted_at: new Date().toISOString(),
        payload: {}, // no confidence field
      },
    ];

    fromChain = buildChain(signals);
    const result = await promoteSignals("user-1", "mpf");

    expect(result.evaluated).toBe(1);
    expect(result.promoted).toBe(0);
    expect(result.rejected).toBe(1);
  });

  it("should throw on Supabase fetch error", async () => {
    fromChain = buildChain([], { message: "connection refused" });

    await expect(promoteSignals("user-1", "mpf")).rejects.toThrow(
      "connection refused",
    );
  });
});
