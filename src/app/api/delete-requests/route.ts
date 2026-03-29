import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canApproveDeletions } from "@/lib/permissions";
import type { UserRole } from "@/lib/types";

/** GET: List pending delete requests (admin/manager) */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    const role = profile?.role as UserRole;
    if (!canApproveDeletions(role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: requests, error } = await supabase
      .from("delete_requests")
      .select(
        `
        *,
        documents:document_id (id, title, category),
        requester:requested_by (full_name, email)
      `
      )
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json(
        { error: `Query failed: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json(requests || []);
  } catch (err) {
    console.error("[delete-requests] GET error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** PATCH: Approve or reject a delete request */
export async function PATCH(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    const role = profile?.role as UserRole;
    if (!canApproveDeletions(role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const { id, action } = body as { id: string; action: string };

    if (!id || !["approve", "reject"].includes(action)) {
      return NextResponse.json(
        { error: "id and action (approve/reject) required" },
        { status: 400 }
      );
    }

    // Update the request status
    const { data: req, error: updateError } = await supabase
      .from("delete_requests")
      .update({
        status: action === "approve" ? "approved" : "rejected",
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("status", "pending")
      .select("*, documents:document_id (id, file_path)")
      .single();

    if (updateError) {
      return NextResponse.json(
        { error: `Update failed: ${updateError.message}` },
        { status: 500 }
      );
    }

    // If approved, actually delete the document
    if (action === "approve" && req) {
      const doc = req.documents as unknown as {
        id: string;
        file_path: string;
      };

      // Soft delete
      await supabase
        .from("documents")
        .update({ is_deleted: true })
        .eq("id", doc.id);

      // Delete chunks
      await supabase.from("chunks").delete().eq("document_id", doc.id);

      // Remove from storage
      if (doc.file_path) {
        await supabase.storage.from("documents").remove([doc.file_path]);
      }
    }

    return NextResponse.json({ success: true, action });
  } catch (err) {
    console.error("[delete-requests] PATCH error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
