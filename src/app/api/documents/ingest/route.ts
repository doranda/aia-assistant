import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ingestDocument } from "@/lib/ingestion";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { documentId, mode } = await request.json();

  // Single document ingest/re-ingest
  if (documentId) {
    const result = await ingestDocument(supabase, documentId);
    return NextResponse.json(result);
  }

  // Batch: ingest all pending/error documents
  if (mode === "all-pending") {
    const { data: docs } = await supabase
      .from("documents")
      .select("id, title, status")
      .eq("is_deleted", false)
      .in("status", ["pending", "error"])
      .order("created_at");

    if (!docs || docs.length === 0) {
      return NextResponse.json({ message: "No pending documents", processed: 0, success: 0, results: [] });
    }

    const results = [];
    for (const doc of docs) {
      const result = await ingestDocument(supabase, doc.id);
      results.push({ id: doc.id, title: doc.title, ...result });
    }

    const ok = results.filter(r => r.success).length;
    return NextResponse.json({ message: `${ok}/${docs.length} ingested`, processed: docs.length, success: ok, results });
  }

  // Re-ingest ALL documents (full rebuild)
  if (mode === "rebuild-all") {
    const { data: docs } = await supabase
      .from("documents")
      .select("id, title")
      .eq("is_deleted", false)
      .order("created_at");

    if (!docs || docs.length === 0) {
      return NextResponse.json({ message: "No documents", processed: 0, success: 0, results: [] });
    }

    const results = [];
    for (const doc of docs) {
      const result = await ingestDocument(supabase, doc.id);
      results.push({ id: doc.id, title: doc.title, ...result });
    }

    const ok = results.filter(r => r.success).length;
    return NextResponse.json({ message: `${ok}/${docs.length} re-ingested`, processed: docs.length, success: ok, results });
  }

  return NextResponse.json({ error: "Provide documentId or mode" }, { status: 400 });
}
