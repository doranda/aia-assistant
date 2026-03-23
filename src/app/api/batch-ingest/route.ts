import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ingestDocument } from "@/lib/ingestion";
import { parseFilename } from "@/lib/parse-filename";
import { readdir, readFile, rename, mkdir } from "fs/promises";
import { join } from "path";

const INGEST_DIR = join(process.cwd(), "docs/pdfs-to-upload");
const DONE_DIR = join(process.cwd(), "docs/pdfs-uploaded");

export async function POST(request: Request) {
  // Protect with a secret (use CRON_SECRET or a simple shared key)
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET || process.env.BATCH_INGEST_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    // If no secret configured, allow any authenticated user
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const supabase = await createClient();

  // Get the first authenticated user as uploader (for batch ops)
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Must be authenticated" }, { status: 401 });
  }

  // Ensure dirs exist
  await mkdir(INGEST_DIR, { recursive: true });
  await mkdir(DONE_DIR, { recursive: true });

  // Scan for PDFs
  let files: string[];
  try {
    const entries = await readdir(INGEST_DIR);
    files = entries.filter((f) => f.toLowerCase().endsWith(".pdf"));
  } catch {
    return NextResponse.json({ error: "Cannot read ingest directory" }, { status: 500 });
  }

  if (files.length === 0) {
    return NextResponse.json({ message: "No PDFs found", processed: 0 });
  }

  const results: { file: string; status: string; docId?: string; error?: string }[] = [];

  for (const filename of files) {
    const filePath = join(INGEST_DIR, filename);
    try {
      // Read file
      const buffer = await readFile(filePath);
      const parsed = parseFilename(filename);

      // Upload to Supabase Storage
      const storagePath = `${user.id}/${Date.now()}-${filename}`;
      const { error: uploadError } = await supabase.storage
        .from("documents")
        .upload(storagePath, buffer, { contentType: "application/pdf", upsert: false });

      if (uploadError) {
        results.push({ file: filename, status: "error", error: `Upload: ${uploadError.message}` });
        continue;
      }

      // Create document record
      const { data: doc, error: dbError } = await supabase
        .from("documents")
        .insert({
          title: parsed.title,
          category: parsed.category,
          source: "upload",
          company: parsed.company || null,
          tags: parsed.tags,
          file_path: storagePath,
          file_size: buffer.length,
          status: "pending",
          uploaded_by: user.id,
        })
        .select()
        .single();

      if (dbError) {
        await supabase.storage.from("documents").remove([storagePath]);
        results.push({ file: filename, status: "error", error: `DB: ${dbError.message}` });
        continue;
      }

      // Ingest (extract text + chunk)
      const ingestion = await ingestDocument(supabase, doc.id);
      if (!ingestion.success) {
        results.push({ file: filename, status: "ingestion_failed", docId: doc.id, error: ingestion.error });
      } else {
        results.push({ file: filename, status: "ok", docId: doc.id });
      }

      // Move to done folder
      await rename(filePath, join(DONE_DIR, filename));
    } catch (err) {
      results.push({ file: filename, status: "error", error: err instanceof Error ? err.message : "Unknown" });
    }
  }

  const success = results.filter((r) => r.status === "ok").length;
  const failed = results.filter((r) => r.status !== "ok").length;

  console.log(`Batch ingest: ${success} succeeded, ${failed} failed out of ${files.length}`);

  return NextResponse.json({
    message: `Processed ${files.length} files: ${success} ok, ${failed} failed`,
    processed: files.length,
    success,
    failed,
    results,
  });
}
