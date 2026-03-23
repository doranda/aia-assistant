/**
 * Server-side OCR using tesseract.js — bilingual English + Traditional Chinese.
 */
import { createWorker } from "tesseract.js";

const OCR_TIMEOUT_MS = 30_000;

/**
 * Extract text from an image buffer using Tesseract OCR.
 * Supports English and Traditional Chinese.
 */
export async function extractTextFromImage(
  buffer: ArrayBuffer
): Promise<string> {
  let worker: Awaited<ReturnType<typeof createWorker>> | null = null;

  try {
    const result = await Promise.race([
      (async () => {
        worker = await createWorker("eng+chi_tra");
        const {
          data: { text },
        } = await worker.recognize(Buffer.from(buffer));
        await worker.terminate();
        worker = null;
        return text.trim();
      })(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("OCR timeout")), OCR_TIMEOUT_MS)
      ),
    ]);

    return result || "[Image could not be read]";
  } catch (err) {
    console.error("OCR error:", err);
    if (worker) {
      try {
        await (worker as Awaited<ReturnType<typeof createWorker>>).terminate();
      } catch {}
    }
    return "[Image could not be read]";
  }
}
