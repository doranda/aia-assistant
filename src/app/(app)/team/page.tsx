import { createClient } from "@/lib/supabase/server";
import { canApproveDeletions } from "@/lib/permissions";
import { TeamManagement } from "@/components/team/team-management";
import type { UserRole } from "@/lib/types";

async function getTeamData() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: currentProfile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const currentRole = (currentProfile?.role || "agent") as UserRole;

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, is_active, last_login, created_at")
    .order("created_at", { ascending: true });

  // Get conversation counts per user
  const { data: convCounts } = await supabase
    .from("conversations")
    .select("user_id");

  const userConvCounts: Record<string, number> = {};
  for (const c of convCounts || []) {
    userConvCounts[c.user_id] = (userConvCounts[c.user_id] || 0) + 1;
  }

  // Get document counts per user
  const { data: docCounts } = await supabase
    .from("documents")
    .select("uploaded_by")
    .eq("is_deleted", false);

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
    const { data: requests } = await supabase
      .from("delete_requests")
      .select(`
        *,
        documents:document_id (id, title, category),
        requester:requested_by (full_name, email)
      `)
      .eq("status", "pending")
      .order("created_at", { ascending: false });

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
    return (
      <div className="max-w-[980px] mx-auto px-6 py-16">
        <p className="text-gray-8">Please sign in to view the team.</p>
      </div>
    );
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
