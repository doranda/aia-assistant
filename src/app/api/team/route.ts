import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManageTeam, canChangeRoles } from "@/lib/permissions";
import type { UserRole } from "@/lib/types";

async function getCurrentUserRole() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { supabase, user: null, role: null };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  return { supabase, user, role: profile?.role as UserRole | null };
}

/** POST: Admin creates a new team member */
export async function POST(request: Request) {
  try {
    const { user, role } = await getCurrentUserRole();

    if (!user || !role) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!canManageTeam(role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const { email, full_name, role: newRole } = body as { email: string; full_name: string; role: UserRole };

    if (!email || !full_name || !newRole) {
      return NextResponse.json(
        { error: "email, full_name, and role are required" },
        { status: 400 }
      );
    }

    const validRoles: UserRole[] = ["admin", "manager", "agent", "member"];
    if (!validRoles.includes(newRole)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    const adminClient = createAdminClient();

    // Invite user by email — Supabase sends an invitation link automatically
    const { data: authData, error: authError } =
      await adminClient.auth.admin.inviteUserByEmail(email, {
        data: { full_name },
      });

    if (authError) {
      return NextResponse.json(
        { error: `Failed to invite user: ${authError.message}` },
        { status: 500 }
      );
    }

    // Update the profile with the correct role (trigger creates profile with default role)
    const { error: profileError } = await adminClient
      .from("profiles")
      .update({ role: newRole, full_name })
      .eq("id", authData.user.id);

    if (profileError) {
      console.error("Failed to update profile role:", profileError);
    }

    return NextResponse.json(
      { id: authData.user.id, email, full_name, role: newRole },
      { status: 201 }
    );
  } catch (err) {
    console.error("[team POST] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** PATCH: Admin changes role or active status */
export async function PATCH(request: Request) {
  try {
    const { supabase, user, role } = await getCurrentUserRole();

    if (!user || !role) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let patchBody: Record<string, unknown>;
    try {
      patchBody = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const { id, role: newRole, is_active } = patchBody as { id: string; role: string; is_active: boolean };

    if (!id) {
      return NextResponse.json({ error: "Member ID required" }, { status: 400 });
    }

    // Cannot change own role
    if (id === user.id && newRole !== undefined) {
      return NextResponse.json(
        { error: "Cannot change your own role" },
        { status: 400 }
      );
    }

    if (newRole !== undefined && !canChangeRoles(role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (is_active !== undefined && !canManageTeam(role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const updates: Record<string, unknown> = {};
    if (newRole !== undefined) updates.role = newRole;
    if (is_active !== undefined) updates.is_active = is_active;

    const { data, error } = await supabase
      .from("profiles")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: `Update failed: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error("[team PATCH] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** DELETE: Admin removes a team member */
export async function DELETE(request: Request) {
  try {
    const { user, role } = await getCurrentUserRole();

    if (!user || !role) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!canManageTeam(role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let deleteBody: Record<string, unknown>;
    try {
      deleteBody = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const { id } = deleteBody as { id: string };

    if (!id) {
      return NextResponse.json({ error: "Member ID required" }, { status: 400 });
    }

    if (id === user.id) {
      return NextResponse.json(
        { error: "Cannot remove yourself" },
        { status: 400 }
      );
    }

    const adminClient = createAdminClient();
    const { error } = await adminClient.auth.admin.deleteUser(id);

    if (error) {
      return NextResponse.json(
        { error: `Failed to remove: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[team DELETE] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
