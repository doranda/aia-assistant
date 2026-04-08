import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ApprovalsList, type PendingItem } from "@/components/approvals/approvals-list";

export const dynamic = "force-dynamic";

interface MpfRow {
  id: string;
  is_emergency: boolean | null;
  decision_date: string;
  expires_at: string | null;
  confirmation_token: string | null;
  old_allocation: unknown;
  new_allocation: unknown;
  created_at: string;
}

interface IlasRow {
  id: string;
  portfolio_type: string;
  is_emergency: boolean | null;
  decision_date: string;
  expires_at: string | null;
  confirmation_token: string | null;
  old_allocation: unknown;
  new_allocation: unknown;
  created_at: string;
}

async function getApprovalsData() {
  const supabase = await createClient();
  const admin = createAdminClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  // Admin gate
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profileError) console.error("[approvals] profile query failed:", profileError);

  if (profile?.role !== "admin") {
    return { unauthorized: true as const };
  }

  // Fetch awaiting_approval rows from both engines
  const { data: mpfRows, error: mpfErr } = await admin
    .from("mpf_pending_switches")
    .select("id, is_emergency, decision_date, expires_at, confirmation_token, old_allocation, new_allocation, created_at")
    .eq("status", "awaiting_approval")
    .order("created_at", { ascending: false });
  if (mpfErr) console.error("[approvals] mpf query failed:", mpfErr);

  const { data: ilasRows, error: ilasErr } = await admin
    .from("ilas_portfolio_orders")
    .select("id, portfolio_type, is_emergency, decision_date, expires_at, confirmation_token, old_allocation, new_allocation, created_at")
    .eq("status", "awaiting_approval")
    .order("created_at", { ascending: false });
  if (ilasErr) console.error("[approvals] ilas query failed:", ilasErr);

  const items: PendingItem[] = [];

  for (const r of (mpfRows || []) as MpfRow[]) {
    items.push({
      id: r.id,
      engine: "mpf",
      portfolioLabel: "MPF Care",
      isEmergency: !!r.is_emergency,
      decisionDate: r.decision_date,
      expiresAt: r.expires_at,
      token: r.confirmation_token || "",
      oldAllocation: r.old_allocation,
      newAllocation: r.new_allocation,
      createdAt: r.created_at,
    });
  }

  for (const r of (ilasRows || []) as IlasRow[]) {
    items.push({
      id: r.id,
      engine: "ilas",
      portfolioLabel: `ILAS Track — ${r.portfolio_type === "accumulation" ? "Accumulation" : "Distribution"}`,
      isEmergency: !!r.is_emergency,
      decisionDate: r.decision_date,
      expiresAt: r.expires_at,
      token: r.confirmation_token || "",
      oldAllocation: r.old_allocation,
      newAllocation: r.new_allocation,
      createdAt: r.created_at,
    });
  }

  // Sort by createdAt desc (most recent first)
  items.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));

  return { unauthorized: false as const, items };
}

export default async function ApprovalsPage() {
  const data = await getApprovalsData();

  if (!data) {
    redirect("/login");
  }

  if (data.unauthorized) {
    return (
      <main className="max-w-3xl mx-auto px-4 py-12">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-zinc-50">Approvals</h1>
        </header>
        <div className="rounded-lg border border-amber-900/40 bg-amber-950/20 p-4">
          <p className="text-sm text-amber-200">Admin access required.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-4xl mx-auto px-4 py-8 sm:py-12">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-zinc-50">Pending Approvals</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Emergency switch requests awaiting your decision. Each request expires 48 hours after creation.
        </p>
      </header>
      <ApprovalsList items={data.items} />
    </main>
  );
}
