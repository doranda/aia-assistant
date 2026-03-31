const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "https://api.ollama.com";
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY || "";
const OLLAMA_CHAT_MODEL = process.env.OLLAMA_CHAT_MODEL || "minimax-m2.7";

interface OllamaMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OllamaChatResponse {
  model: string;
  message: { role: string; content: string; thinking?: string };
  done: boolean;
}

export async function ollamaChat(
  messages: OllamaMessage[],
  options?: { model?: string }
): Promise<string> {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OLLAMA_API_KEY}`,
    },
    body: JSON.stringify({
      model: options?.model || OLLAMA_CHAT_MODEL,
      messages,
      stream: false,
    }),
  });

  if (!res.ok) {
    throw new Error(`Ollama error: ${res.status} ${await res.text()}`);
  }

  const data: OllamaChatResponse = await res.json();
  return data.message.content;
}

export async function ollamaChatStream(
  messages: OllamaMessage[],
  options?: { model?: string }
): Promise<ReadableStream<Uint8Array>> {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OLLAMA_API_KEY}`,
    },
    body: JSON.stringify({
      model: options?.model || OLLAMA_CHAT_MODEL,
      messages,
      stream: true,
    }),
  });

  if (!res.ok) {
    throw new Error(`Ollama error: ${res.status} ${await res.text()}`);
  }

  if (!res.body) throw new Error("Ollama returned no response body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  return new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      // Keep the last element as buffer (it may be incomplete)
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const data = JSON.parse(trimmed) as OllamaChatResponse;
          // Forward actual content tokens (skip thinking-only tokens)
          if (data.message?.content) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ content: data.message.content })}\n\n`
              )
            );
          } else if (data.message?.thinking && !data.done) {
            // Send a keep-alive comment during thinking to prevent timeout
            controller.enqueue(encoder.encode(": thinking\n\n"));
          }
          if (data.done) {
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
            return;
          }
        } catch {
          // Skip malformed lines
        }
      }
    },
  });
}
