import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ollamaChatStream } from "@/lib/ollama";
import {
  searchDocuments,
  formatContextForPrompt,
  extractCitations,
  matchFAQ,
} from "@/lib/search";

const SYSTEM_PROMPT = `You are Knowledge Hub, an AI assistant for AIA HK insurance agents.

ROLE: You DISTILL and SYNTHESIZE information. You do NOT copy-paste source text. You read the documents, understand them, and give clear, actionable answers in your own words.

RESPONSE RULES:
1. SYNTHESIZE — read the source material, then explain it clearly. Never dump raw document text. Transform messy PDF content into clean, readable answers.
2. STRUCTURE — use short paragraphs, bullet points, and bold key terms. Keep responses concise (aim for 150-300 words unless the question requires more detail).
3. CITE — mention source document names naturally (e.g. "According to the OYS launchpad...") but do NOT include raw [Source] tags or page numbers inline.
4. LANGUAGE — match the user's language. If they ask in English, answer in English. If Chinese, answer in Chinese. For product names, include both English and Chinese names when available.
5. HONESTY — if the documents don't cover something, say so briefly and suggest what IS covered.

FORMAT:
- Start with a direct 1-2 sentence answer
- Then provide supporting details in bullets or short paragraphs
- End with 2-3 follow-up suggestions on separate lines starting with "💡 "

BAD (don't do this):
> *"根據文件第32頁..."* followed by raw Chinese text dumps

GOOD (do this):
"The On Your Side (愛伴航) plan covers 115 illnesses including 58 critical illnesses. Key benefits include..."

The document excerpts are provided below. Read them, understand them, then answer in your own words.`;

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { message, conversationId, language } = body as { message: string; conversationId: string; language: string };

  if (!message?.trim()) {
    return NextResponse.json(
      { error: "Message is required" },
      { status: 400 }
    );
  }

  // Track query for learning — upsert into popular_queries
  const queryHash = message.trim().toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ");
  const { data: existingQuery } = await supabase
    .from("popular_queries")
    .select("id, count")
    .eq("query_hash", queryHash)
    .single();

  if (existingQuery) {
    await supabase
      .from("popular_queries")
      .update({ count: existingQuery.count + 1, last_asked_at: new Date().toISOString(), last_asked_by: user.id })
      .eq("id", existingQuery.id);
  } else {
    await supabase
      .from("popular_queries")
      .insert({ query_text: message.trim(), query_hash: queryHash, last_asked_by: user.id });
  }

  // 0. Check FAQs first — instant response if matched
  const faqMatch = await matchFAQ(supabase, message);
  if (faqMatch) {
    // Get or create conversation for FAQ response
    let faqConvId = conversationId;
    if (!faqConvId) {
      const title = message.length > 60 ? message.substring(0, 57) + "..." : message;
      const { data: conv } = await supabase
        .from("conversations")
        .insert({ user_id: user.id, title })
        .select()
        .single();
      if (conv) faqConvId = conv.id;
    }

    if (faqConvId) {
      await supabase.from("messages").insert({ conversation_id: faqConvId, role: "user", content: message });
      await supabase.from("messages").insert({
        conversation_id: faqConvId,
        role: "assistant",
        content: faqMatch.faq.answer,
        sources: faqMatch.faq.sources,
      });
      await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", faqConvId);
      // Increment use count
      await supabase.from("faqs").update({ use_count: faqMatch.faq.use_count + 1 }).eq("id", faqMatch.faq.id);
    }

    const faqCitations = faqMatch.faq.sources || [];
    // Return as SSE stream for consistency with the client
    const encoder = new TextEncoder();
    const faqStream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ faq: true })}\n\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: faqMatch.faq.answer })}\n\n`));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    return new Response(faqStream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Conversation-Id": faqConvId || "",
        "X-Citations": JSON.stringify(faqCitations),
        "X-FAQ-Match": "true",
        "Access-Control-Expose-Headers": "X-Conversation-Id, X-Citations, X-FAQ-Match",
      },
    });
  }

  // 1. Search for relevant document chunks
  const searchResults = await searchDocuments(supabase, message, {
    matchCount: 5,
  });

  console.log(`Chat search: "${message.substring(0, 50)}" → ${searchResults.length} results`);
  if (searchResults.length > 0) {
    console.log(`  Top result: "${searchResults[0].doc_title}", page ${searchResults[0].page_number}, rank ${searchResults[0].rank}`);
  }

  const context = formatContextForPrompt(searchResults);
  const citations = extractCitations(searchResults);

  // 2. Get or create conversation
  let convId = conversationId;
  if (!convId) {
    const title =
      message.length > 60 ? message.substring(0, 57) + "..." : message;
    const { data: conv, error } = await supabase
      .from("conversations")
      .insert({ user_id: user.id, title })
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: `Failed to create conversation: ${error.message}` },
        { status: 500 }
      );
    }
    convId = conv.id;
  }

  // 3. Load conversation history BEFORE inserting new message (avoids duplication)
  const { data: history } = await supabase
    .from("messages")
    .select("role, content")
    .eq("conversation_id", convId)
    .order("created_at", { ascending: true })
    .limit(10);

  // 4. Save user message
  await supabase.from("messages").insert({
    conversation_id: convId,
    role: "user",
    content: message,
  });

  // 5. Build messages for Ollama
  // Embed the document context directly in the user message so the model can't ignore it
  const userMessageWithContext = searchResults.length > 0
    ? `Based on the following document excerpts, answer my question.\n\n---\nDOCUMENT EXCERPTS:\n${context}\n---\n\nMy question: ${message}`
    : message;

  const langInstruction = language === "zh"
    ? "\n\nLANGUAGE: Reply in Chinese (繁體中文). Use Chinese for all explanations. Keep product names in both English and Chinese."
    : language === "en"
      ? "\n\nLANGUAGE: Reply in English. Use English for all explanations. Include Chinese product names in parentheses where relevant."
      : "\n\nLANGUAGE: Match the user's language. If they write in English, reply in English. If Chinese, reply in Chinese.";

  const ollamaMessages = [
    { role: "system" as const, content: SYSTEM_PROMPT + langInstruction },
    ...(history || []).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user" as const, content: userMessageWithContext },
  ];

  // 6. Stream response from Ollama
  try {
    const stream = await ollamaChatStream(ollamaMessages);

    // Collect full response for saving to DB
    let fullResponse = "";

    const transformStream = new TransformStream({
      transform(chunk, controller) {
        const text = new TextDecoder().decode(chunk);
        // Extract content from SSE format
        const lines = text.split("\n").filter((l) => l.startsWith("data: "));
        for (const line of lines) {
          const data = line.replace("data: ", "");
          if (data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.content) fullResponse += parsed.content;
          } catch {}
        }
        controller.enqueue(chunk);
      },
      async flush() {
        // Save assistant message and update conversation timestamp
        if (fullResponse) {
          await supabase.from("messages").insert({
            conversation_id: convId,
            role: "assistant",
            content: fullResponse,
            sources: citations.length > 0 ? citations : null,
          });
          await supabase
            .from("conversations")
            .update({ updated_at: new Date().toISOString() })
            .eq("id", convId);
        }
      },
    });

    const responseStream = stream.pipeThrough(transformStream);

    return new Response(responseStream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Conversation-Id": convId,
        "X-Citations": JSON.stringify(citations),
        "Access-Control-Expose-Headers": "X-Conversation-Id, X-Citations, X-FAQ-Match",
      },
    });
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "AI service unavailable";
    return NextResponse.json({ error: errorMessage }, { status: 503 });
  }
}
