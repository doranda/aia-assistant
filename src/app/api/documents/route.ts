import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ingestDocument } from "@/lib/ingestion";

export async function PATCH(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Only admin/manager can edit document metadata
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    const userRole = (profile?.role || "member") as import("@/lib/types").UserRole;
    if (userRole !== "admin" && userRole !== "manager") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const { id, title, category, company, tags } = body as { id: string; title: string; category: string; company: string; tags: string[] };

    if (!id) {
      return NextResponse.json({ error: "Document ID is required" }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};
    if (title !== undefined) updates.title = title;
    if (category !== undefined) updates.category = category;
    if (company !== undefined) updates.company = company || null;
    if (tags !== undefined) updates.tags = tags;

    const { data: doc, error } = await supabase
      .from("documents")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("[documents] PATCH update failed:", error);
      return NextResponse.json({ error: "Update failed" }, { status: 500 });
    }

    return NextResponse.json(doc);
  } catch (err) {
    console.error("[documents] PATCH error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
    }
    const file = formData.get("file") as File | null;
    const category = formData.get("category") as string;
    const company = formData.get("company") as string | null;
    const tags = formData.get("tags") as string | null;

    if (!file || !category) {
      return NextResponse.json({ error: "File and category are required" }, { status: 400 });
    }

    if (file.type !== "application/pdf") {
      return NextResponse.json({ error: "Only PDF files allowed" }, { status: 400 });
    }
    if (file.size > 50 * 1024 * 1024) {
      return NextResponse.json({ error: "File exceeds 50MB limit" }, { status: 400 });
    }

    const fileName = `${user.id}/${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage
      .from("documents")
      .upload(fileName, file, { contentType: "application/pdf", upsert: false });

    if (uploadError) {
      return NextResponse.json({ error: `Upload failed: ${uploadError.message}` }, { status: 500 });
    }

    const { data: doc, error: dbError } = await supabase
      .from("documents")
      .insert({
        title: file.name.replace(/\.pdf$/i, ""),
        category,
        source: "upload",
        company: company || null,
        tags: tags ? tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
        file_path: fileName,
        file_size: file.size,
        status: "pending",
        uploaded_by: user.id,
      })
      .select()
      .single();

    if (dbError) {
      await supabase.storage.from("documents").remove([fileName]);
      return NextResponse.json({ error: `Database error: ${dbError.message}` }, { status: 500 });
    }

    // Trigger ingestion (fire and forget — runs async)
    ingestDocument(supabase, doc.id).then((result) => {
      if (result.success) {
        console.log(`Ingestion complete: ${doc.id}, ${result.chunkCount} chunks`);
      } else {
        console.error(`Ingestion failed for ${doc.id}:`, result.error);
      }
    }).catch((err) => {
      console.error("Ingestion crashed:", err);
    });

    return NextResponse.json(doc, { status: 201 });
  } catch (err) {
    console.error("[documents] POST error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let deleteBody: Record<string, unknown>;
    try {
      deleteBody = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const { id, reason } = deleteBody as { id: string; reason: string };

    if (!id) {
      return NextResponse.json({ error: "Document ID is required" }, { status: 400 });
    }

    // Check user role
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profileError) {
      console.error("[documents] DELETE profile query error:", profileError);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    const role = profile?.role as import("@/lib/types").UserRole;

    // Agents/members create a delete request instead of deleting directly
    if (role === "agent" || role === "member") {
      const { error: reqError } = await supabase.from("delete_requests").insert({
        document_id: id,
        requested_by: user.id,
        reason: reason || null,
      });

      if (reqError) {
        return NextResponse.json(
          { error: `Request failed: ${reqError.message}` },
          { status: 500 }
        );
      }

      return NextResponse.json({ success: true, requested: true });
    }

    // Admin/manager: delete directly
    const { data: doc } = await supabase
      .from("documents")
      .select("file_path")
      .eq("id", id)
      .single();

    const { error } = await supabase
      .from("documents")
      .update({ is_deleted: true })
      .eq("id", id);

    if (error) {
      return NextResponse.json({ error: `Delete failed: ${error.message}` }, { status: 500 });
    }

    const { error: chunkDeleteErr } = await supabase.from("chunks").delete().eq("document_id", id);
    if (chunkDeleteErr) console.error("[documents] chunks delete:", chunkDeleteErr);

    if (doc?.file_path) {
      await supabase.storage.from("documents").remove([doc.file_path]);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[documents] DELETE error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
