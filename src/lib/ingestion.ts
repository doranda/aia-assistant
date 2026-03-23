import { SupabaseClient } from "@supabase/supabase-js";

/**
 * Extract text from a PDF buffer, preserving page numbers.
 */
export async function extractPdfText(
  buffer: ArrayBuffer
): Promise<{ text: string; pageNumber: number }[]> {
  // Import the lib directly to skip pdf-parse's test file requirement
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = (await import("pdf-parse")).default;
  const nodeBuffer = Buffer.from(buffer);
  const data = await pdfParse(nodeBuffer);

  const pages: { text: string; pageNumber: number }[] = [];
  const rawText = data.text;

  if (data.numpages <= 1) {
    pages.push({ text: rawText.trim(), pageNumber: 1 });
  } else {
    // pdf-parse separates pages with form feed characters
    const pageTexts = rawText.split(/\f/);
    for (let i = 0; i < pageTexts.length; i++) {
      const text = pageTexts[i].trim();
      if (text) {
        pages.push({ text, pageNumber: i + 1 });
      }
    }
    // Fallback if form-feed splitting didn't work
    if (pages.length === 0) {
      pages.push({ text: rawText.trim(), pageNumber: 1 });
    }
  }

  return pages;
}

/**
 * Split text into ~500 token chunks with ~50 token overlap.
 * Approximation: 1 token ≈ 4 characters.
 */
export function chunkText(
  text: string,
  chunkSize: number = 2000,
  overlap: number = 200
): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = start + chunkSize;

    // Try to break at a sentence boundary
    if (end < text.length) {
      const nearEnd = text.substring(end - 200, end + 200);
      const sentenceBreak = nearEnd.search(/[.!?。！？]\s/);
      if (sentenceBreak !== -1) {
        end = end - 200 + sentenceBreak + 2;
      }
    }

    const chunk = text.substring(start, Math.min(end, text.length)).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }

    start = end - overlap;
    if (start >= text.length) break;
  }

  return chunks;
}

/**
 * Ingest a document: download PDF, extract text, chunk, store in DB.
 */
export async function ingestDocument(
  supabase: SupabaseClient,
  documentId: string
): Promise<{ success: boolean; error?: string; chunkCount?: number }> {
  // 1. Get document record
  const { data: doc, error: docError } = await supabase
    .from("documents")
    .select("*")
    .eq("id", documentId)
    .single();

  if (docError || !doc) {
    return { success: false, error: `Document not found: ${docError?.message}` };
  }

  // 2. Update status to processing
  await supabase
    .from("documents")
    .update({ status: "processing" })
    .eq("id", documentId);

  try {
    // 3. Download PDF from storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("documents")
      .download(doc.file_path);

    if (downloadError || !fileData) {
      throw new Error(`Download failed: ${downloadError?.message}`);
    }

    // 4. Extract text
    const buffer = await fileData.arrayBuffer();
    const pages = await extractPdfText(buffer);

    if (pages.length === 0 || pages.every((p) => !p.text)) {
      throw new Error("No text could be extracted from PDF");
    }

    // 5. Chunk each page
    const allChunks: {
      document_id: string;
      content: string;
      page_number: number;
      chunk_index: number;
    }[] = [];

    let globalIndex = 0;
    for (const page of pages) {
      const chunks = chunkText(page.text);
      for (const chunk of chunks) {
        allChunks.push({
          document_id: documentId,
          content: chunk,
          page_number: page.pageNumber,
          chunk_index: globalIndex++,
        });
      }
    }

    // 6. Delete old chunks (if re-ingesting)
    await supabase.from("chunks").delete().eq("document_id", documentId);

    // 7. Insert chunks in batches
    const batchSize = 50;
    for (let i = 0; i < allChunks.length; i += batchSize) {
      const batch = allChunks.slice(i, i + batchSize);
      const { error: insertError } = await supabase
        .from("chunks")
        .insert(batch);

      if (insertError) {
        throw new Error(`Chunk insert failed: ${insertError.message}`);
      }
    }

    // 8. Update document status + page count
    await supabase
      .from("documents")
      .update({
        status: "indexed",
        page_count: pages.length,
      })
      .eq("id", documentId);

    return { success: true, chunkCount: allChunks.length };
  } catch (err) {
    await supabase
      .from("documents")
      .update({ status: "error" })
      .eq("id", documentId);

    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
