import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canApproveDeletions } from "@/lib/permissions";
import { TeamManagement } from "@/components/team/team-management";
import { TeamSignInRequired } from "@/components/team/team-sign-in-required";
import type { UserRole } from "@/lib/types";

async function getTeamData() {
  const supabase = await createClient();
  const admin = createAdminClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: currentProfile, error: profileError } = await admin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profileError) console.error("[team] Failed to fetch current profile:", profileError);

  const currentRole = (currentProfile?.role || "agent") as UserRole;

  const { data: profiles, error: profilesError } = await admin
    .from("profiles")
    .select("id, email, full_name, role, is_active, last_login, created_at")
    .order("created_at", { ascending: true });
  if (profilesError) console.error("[team] Failed to fetch profiles:", profilesError);

  // Get conversation counts per user
  const { data: convCounts, error: convError } = await admin
    .from("conversations")
    .select("user_id");
  if (convError) console.error("[team] Failed to fetch conversation counts:", convError);

  const userConvCounts: Record<string, number> = {};
  for (const c of convCounts || []) {
    userConvCounts[c.user_id] = (userConvCounts[c.user_id] || 0) + 1;
  }

  // Get document counts per user
  const { data: docCounts, error: docError } = await admin
    .from("documents")
    .select("uploaded_by")
    .eq("is_deleted", false);
  if (docError) console.error("[team] Failed to fetch document counts:", docError);

  const userDocCounts: Record<string, number> = {};
  for (const d of docCounts || []) {
    userDocCounts[d.uploaded_by] = (userDocCounts[d.uploaded_by] || 0) + 1;
  }

  const members = (profiles || []).map((p) => ({
    ...p,
    role: p.role as UserRole,
    conversations: userConvCounts[p.id] || 0,
    documents: userDocCounts[p.id] || 0,
  }));

  // Fetch pending delete requests if admin/manager
  let deleteRequests: unknown[] = [];
  if (canApproveDeletions(currentRole)) {
    const { data: requests, error: reqError } = await admin
      .from("delete_requests")
      .select(`
        *,
        documents:document_id (id, title, category),
        requester:requested_by (full_name, email)
      `)
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    if (reqError) console.error("[team] Failed to fetch delete requests:", reqError);

    deleteRequests = requests || [];
  }

  return {
    currentUserId: user.id,
    currentUserRole: currentRole,
    members,
    deleteRequests,
  };
}

export default async function TeamPage() {
  const data = await getTeamData();

  if (!data) {
    return <TeamSignInRequired />;
  }

  return (
    <TeamManagement
      currentUserId={data.currentUserId}
      currentUserRole={data.currentUserRole}
      initialMembers={data.members}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      initialDeleteRequests={data.deleteRequests as any}
    />
  );
}
