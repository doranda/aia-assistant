/**
 * Client-side image utilities for claim check attachments.
 */

const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
];

const ACCEPTED_PDF_TYPES = ["application/pdf"];

/**
 * Resize an image file to fit within maxDimension, output as JPEG 0.85 quality.
 * Typically produces a Blob under 1MB.
 */
export async function resizeImage(
  file: File,
  maxDimension: number = 2048
): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;

  let targetWidth = width;
  let targetHeight = height;

  if (width > maxDimension || height > maxDimension) {
    const ratio = Math.min(maxDimension / width, maxDimension / height);
    targetWidth = Math.round(width * ratio);
    targetHeight = Math.round(height * ratio);
  }

  const canvas = new OffscreenCanvas(targetWidth, targetHeight);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas context unavailable");

  ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
  bitmap.close();

  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
  return blob;
}

/**
 * Check if a file is an accepted image type.
 */
export function isImageFile(file: File): boolean {
  return ACCEPTED_IMAGE_TYPES.includes(file.type);
}

/**
 * Check if a file is a PDF.
 */
export function isPdfFile(file: File): boolean {
  return ACCEPTED_PDF_TYPES.includes(file.type);
}
