import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ollamaChatStream } from "@/lib/ollama";
import {
  searchDocuments,
  formatContextForPrompt,
  extractCitations,
} from "@/lib/search";
import { extractPdfText } from "@/lib/ingestion";
import { extractTextFromImage } from "@/lib/ocr";

export const maxDuration = 60;

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/heic", "image/heif"];

const SYSTEM_PROMPT = `You are Knowledge Hub, an AI assistant for AIA HK insurance agents.

ROLE: You analyze claim eligibility by cross-referencing the user's claim details (and any attached documents) against policy documentation.

RESPONSE RULES:
1. SYNTHESIZE — read the source material, then explain it clearly. Never dump raw document text.
2. STRUCTURE — use short paragraphs, bullet points, and bold key terms. Keep responses concise.
3. CITE — mention source document names naturally.
4. LANGUAGE — match the user's requested language.
5. HONESTY — if the documents don't cover something, say so briefly.

FORMAT:
- Start with a clear eligibility assessment (Likely Eligible / Likely Not Eligible / Unclear)
- Then provide supporting details in bullets
- Note any required documents, limits, or exclusions
- End with 2-3 follow-up suggestions on separate lines starting with "💡 "`;

export async function POST(request: Request) {
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
    return NextResponse.json(
      { error: "Invalid form data" },
      { status: 400 }
    );
  }

  const claimType = formData.get("claimType") as string;
  const amount = (formData.get("amount") as string) || "not specified";
  const description = (formData.get("description") as string) || "";
  const language = (formData.get("language") as string) || "auto";
  const files = formData.getAll("files") as File[];

  // File size limit: 20MB per file, 5 files max
  const MAX_FILE_SIZE = 20 * 1024 * 1024;
  const MAX_FILES = 5;
  if (files.length > MAX_FILES) {
    return NextResponse.json({ error: `Maximum ${MAX_FILES} files allowed` }, { status: 400 });
  }
  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: `File "${file.name}" exceeds 20MB limit` }, { status: 400 });
    }
  }

  if (!claimType?.trim()) {
    return NextResponse.json(
      { error: "Claim type is required" },
      { status: 400 }
    );
  }

  // Extract text from attached files
  const extractedTexts: string[] = [];

  for (const file of files) {
    try {
      const buffer = await file.arrayBuffer();

      if (file.type === "application/pdf") {
        const pages = await extractPdfText(buffer);
        const pdfText = pages.map((p) => p.text).join("\n\n");
        if (pdfText.trim()) {
          extractedTexts.push(`[PDF: ${file.name}]\n${pdfText}`);
        }
      } else if (IMAGE_TYPES.includes(file.type)) {
        const ocrText = await extractTextFromImage(buffer);
        if (ocrText && ocrText !== "[Image could not be read]") {
          extractedTexts.push(`[Image: ${file.name}]\n${ocrText}`);
        }
      }
    } catch (err) {
      console.error(`Failed to process attachment ${file.name}:`, err);
    }
  }

  const attachmentContext = extractedTexts.length > 0
    ? `\n\nATTACHED DOCUMENT CONTENT:\n${extractedTexts.join("\n\n---\n\n")}`
    : "";

  const query = `Is this claim eligible? Type: ${claimType}. Amount: ${amount}. Details: ${description}.${attachmentContext}\n\nCheck the policy documents for coverage, limits, exclusions, and required documents.`;

  // Search policy docs
  const searchResults = await searchDocuments(supabase, query, {
    matchCount: 5,
  });

  console.log(
    `Claim check: "${claimType}" → ${searchResults.length} results, ${files.length} attachments`
  );

  const context = formatContextForPrompt(searchResults);
  const citations = extractCitations(searchResults);

  // Build messages for Ollama
  const userMessageWithContext =
    searchResults.length > 0
      ? `Based on the following document excerpts, assess this claim.\n\n---\nDOCUMENT EXCERPTS:\n${context}\n---\n\n${query}`
      : query;

  const langInstruction =
    language === "zh"
      ? "\n\nLANGUAGE: Reply in Chinese (繁體中文). Use Chinese for all explanations. Keep product names in both English and Chinese."
      : language === "en"
        ? "\n\nLANGUAGE: Reply in English. Use English for all explanations. Include Chinese product names in parentheses where relevant."
        : "\n\nLANGUAGE: Match the user's language. If they write in English, reply in English. If Chinese, reply in Chinese.";

  const ollamaMessages = [
    { role: "system" as const, content: SYSTEM_PROMPT + langInstruction },
    { role: "user" as const, content: userMessageWithContext },
  ];

  // Stream response
  try {
    const stream = await ollamaChatStream(ollamaMessages);

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Citations": JSON.stringify(citations),
        "Access-Control-Expose-Headers": "X-Citations",
      },
    });
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "AI service unavailable";
    return NextResponse.json({ error: errorMessage }, { status: 503 });
  }
}
