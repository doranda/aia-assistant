"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { Conversation, Message, MessageSource } from "@/lib/types";
import { ConversationSidebar } from "@/components/chat/conversation-sidebar";
import { ConversationDrawer } from "@/components/chat/conversation-drawer";
import { MessageBubble } from "@/components/chat/message-bubble";
import { ChatInput } from "@/components/chat/chat-input";
import { createClient } from "@/lib/supabase/client";

interface ChatViewProps {
  conversations: Conversation[];
  initialConversationId?: string;
}

export function ChatView({ conversations, initialConversationId }: ChatViewProps) {
  const [activeConvId, setActiveConvId] = useState<string | null>(initialConversationId || null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingCitations, setStreamingCitations] = useState<MessageSource[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isFAQResponse, setIsFAQResponse] = useState(false);
  const [convList, setConvList] = useState(conversations);
  const [language, setLanguage] = useState<"auto" | "en" | "zh">("auto");
  const [suggestions, setSuggestions] = useState<string[]>([
    "What plans do we offer?",
    "How do I submit a claim?",
    "What are the exclusion clauses?",
    "Compare our medical plans",
  ]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const skipNextLoad = useRef(false);

  useEffect(() => {
    fetch("/api/popular-queries")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data) && data.length >= 2) {
          setSuggestions(data.slice(0, 4).map((q: { query_text: string }) => q.query_text));
        }
      })
      .catch(() => {});
  }, []);

  const loadMessages = useCallback(async (convId: string) => {
    const supabase = createClient();
    const { data } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", convId)
      .order("created_at", { ascending: true });
    setMessages((data || []) as Message[]);
  }, []);

  useEffect(() => {
    if (skipNextLoad.current) {
      skipNextLoad.current = false;
      return;
    }
    if (activeConvId) {
      loadMessages(activeConvId);
    } else {
      setMessages([]);
    }
  }, [activeConvId, loadMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  function handleNewChat() {
    setActiveConvId(null);
    setMessages([]);
    setStreamingContent("");
    setIsFAQResponse(false);
  }

  async function handleDelete(convId: string) {
    const res = await fetch(`/api/chat/${convId}`, { method: "DELETE" });
    if (!res.ok) return;
    setConvList((prev) => prev.filter((c) => c.id !== convId));
    if (activeConvId === convId) {
      setActiveConvId(null);
      setMessages([]);
    }
  }

  async function handleSaveAsFAQ(question: string, answer: string, sources: MessageSource[] | null) {
    await fetch("/api/faq", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, answer, sources }),
    });
  }

  // Find the user question that precedes a given assistant message index
  function getUserQuestionForIndex(msgIndex: number): string {
    for (let i = msgIndex - 1; i >= 0; i--) {
      if (messages[i].role === "user") return messages[i].content;
    }
    return "";
  }

  async function handleSend(message: string) {
    const tempUserMsg: Message = {
      id: crypto.randomUUID(),
      conversation_id: activeConvId || "",
      role: "user",
      content: message,
      sources: null,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);
    setIsStreaming(true);
    setStreamingContent("");
    setStreamingCitations([]);
    setIsFAQResponse(false);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, conversationId: activeConvId, language }),
      });

      if (!res.ok) {
        const data = await res.json();
        setStreamingContent(data.error || "Failed to get response");
        setIsStreaming(false);
        return;
      }

      const newConvId = res.headers.get("X-Conversation-Id");
      if (newConvId && newConvId !== activeConvId) {
        skipNextLoad.current = true;
        setActiveConvId(newConvId);
        const supabase = createClient();
        const { data: convs } = await supabase
          .from("conversations")
          .select("*")
          .eq("user_id", (await supabase.auth.getUser()).data.user?.id)
          .order("updated_at", { ascending: false });
        setConvList((convs || []) as Conversation[]);
      }

      const isFAQ = res.headers.get("X-FAQ-Match") === "true";
      setIsFAQResponse(isFAQ);

      let parsedCitations: MessageSource[] = [];
      const citationsHeader = res.headers.get("X-Citations");
      if (citationsHeader) {
        try {
          parsedCitations = JSON.parse(citationsHeader);
          setStreamingCitations(parsedCitations);
        } catch {
          // ignore malformed citations header
        }
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      let detectedFAQ = isFAQ;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        const lines = text.split("\n").filter((l) => l.startsWith("data: "));

        for (const line of lines) {
          const data = line.replace("data: ", "");
          if (data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.faq) {
              detectedFAQ = true;
              setIsFAQResponse(true);
            }
            if (parsed.content) {
              accumulated += parsed.content;
              setStreamingContent(accumulated);
            }
          } catch {
            // ignore malformed SSE tokens
          }
        }
      }

      const finalMsg: Message & { isFAQ?: boolean } = {
        id: crypto.randomUUID(),
        conversation_id: activeConvId || newConvId || "",
        role: "assistant",
        content: accumulated,
        sources: parsedCitations.length > 0 ? parsedCitations : null,
        created_at: new Date().toISOString(),
        isFAQ: detectedFAQ,
      };
      setMessages((prev) => [...prev, finalMsg]);
      setStreamingContent("");
    } catch {
      setStreamingContent("Failed to connect to AI service. Please try again.");
    }

    setIsStreaming(false);
  }

  return (
    <div className="flex h-[calc(100dvh-48px-80px)] lg:h-[calc(100dvh-48px)]">
      <ConversationSidebar
        conversations={convList}
        activeId={activeConvId}
        onSelect={setActiveConvId}
        onNew={handleNewChat}
        onDelete={handleDelete}
      />

      <div className="flex-1 flex flex-col max-w-[720px] mx-auto px-4 lg:px-8 w-full">
        <ConversationDrawer
          conversations={convList}
          activeId={activeConvId}
          onSelect={setActiveConvId}
          onNew={handleNewChat}
          onDelete={handleDelete}
        />

        <div className="flex-1 overflow-y-auto py-6 scroll-smooth">
          {messages.length === 0 && !streamingContent && (
            <div className="flex flex-col items-center justify-center h-full text-center px-4">
              <h2 className="text-[clamp(1.5rem,3vw,2.25rem)] font-semibold tracking-[-0.03em] text-zinc-50 leading-[1.1] mb-3">
                Ask anything
              </h2>
              <p className="text-sm text-zinc-500 max-w-sm mb-6">
                Search across your uploaded insurance documents. Answers include source citations.
              </p>
              <div className="flex flex-wrap justify-center gap-2 max-w-lg">
                {suggestions.map((q) => (
                  <button
                    key={q}
                    onClick={() => handleSend(q)}
                    disabled={isStreaming}
                    className="px-3.5 py-2 text-[13px] rounded-lg border border-white/[0.06] bg-white/[0.03] text-gray-9 hover:bg-white/[0.06] hover:text-white transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <MessageBubble
              key={msg.id}
              role={msg.role}
              content={msg.content}
              sources={msg.sources}
              isFAQ={(msg as Message & { isFAQ?: boolean }).isFAQ}
              userQuestion={msg.role === "assistant" ? getUserQuestionForIndex(i) : undefined}
              onSaveAsFAQ={msg.role === "assistant" ? handleSaveAsFAQ : undefined}
            />
          ))}

          {isStreaming && !streamingContent && (
            <div className="mb-10">
              <div className="text-[12px] font-bold uppercase tracking-[0.08em] text-gray-7 mb-2.5">
                Knowledge Hub
              </div>
              <div className="flex items-center gap-1.5 py-2">
                <span className="w-2 h-2 rounded-full bg-ruby-10 animate-[bounce_1.4s_ease-in-out_infinite]" />
                <span className="w-2 h-2 rounded-full bg-ruby-10 animate-[bounce_1.4s_ease-in-out_0.2s_infinite]" />
                <span className="w-2 h-2 rounded-full bg-ruby-10 animate-[bounce_1.4s_ease-in-out_0.4s_infinite]" />
                <span className="text-sm text-gray-8 ml-2">Searching documents...</span>
              </div>
            </div>
          )}

          {streamingContent && (
            <MessageBubble
              role="assistant"
              content={streamingContent}
              sources={streamingCitations.length > 0 ? streamingCitations : null}
              isStreaming={isStreaming}
              isFAQ={isFAQResponse}
            />
          )}

          <div ref={messagesEndRef} />
        </div>

        <div className="flex items-center gap-2 px-1 mb-1">
          <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-gray-7">Reply in</span>
          {(["auto", "en", "zh"] as const).map((lang) => (
            <button
              key={lang}
              onClick={() => setLanguage(lang)}
              className={`text-[11px] px-2.5 py-1 rounded-full transition-all ${
                language === lang
                  ? "bg-white/[0.08] text-[#f5f5f7] font-semibold"
                  : "text-gray-8 hover:text-gray-11"
              }`}
            >
              {lang === "auto" ? "Auto" : lang === "en" ? "English" : "中文"}
            </button>
          ))}
        </div>
        <ChatInput onSend={handleSend} disabled={isStreaming} />
      </div>
    </div>
  );
}
