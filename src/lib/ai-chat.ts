import { streamText } from "ai";

const CHAT_MODEL = process.env.CHAT_MODEL || "deepseek/deepseek-chat";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Stream a chat response via Vercel AI Gateway.
 * Returns an SSE-formatted ReadableStream compatible with the existing client.
 */
export async function aiChatStream(
  messages: ChatMessage[]
): Promise<ReadableStream<Uint8Array>> {
  const result = streamText({
    model: CHAT_MODEL as `${string}/${string}`,
    messages,
  });

  const encoder = new TextEncoder();
  const textStream = result.textStream;
  const reader = textStream.getReader();

  return new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
        return;
      }
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ content: value })}\n\n`)
      );
    },
  });
}
