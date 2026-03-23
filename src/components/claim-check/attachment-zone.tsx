"use client";

import { useCallback, useState, useRef } from "react";
import { isImageFile, isPdfFile, resizeImage } from "@/lib/image-utils";

const MAX_FILES = 3;
const ACCEPT = ".pdf,.jpg,.jpeg,.png,.heic,.heif";

interface AttachmentZoneProps {
  onFilesChange: (files: File[]) => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentZone({ onFilesChange }: AttachmentZoneProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(
    async (incoming: FileList | File[]) => {
      const accepted = Array.from(incoming).filter(
        (f) => isImageFile(f) || isPdfFile(f)
      );

      if (accepted.length === 0) return;

      setProcessing(true);

      // Resize images client-side
      const processed: File[] = [];
      for (const file of accepted) {
        if (isImageFile(file)) {
          try {
            const resized = await resizeImage(file);
            processed.push(
              new File([resized], file.name.replace(/\.[^.]+$/, ".jpg"), {
                type: "image/jpeg",
              })
            );
          } catch {
            // If resize fails, use original
            processed.push(file);
          }
        } else {
          processed.push(file);
        }
      }

      setProcessing(false);

      const updated = [...files, ...processed].slice(0, MAX_FILES);
      setFiles(updated);
      onFilesChange(updated);
    },
    [files, onFilesChange]
  );

  const removeFile = useCallback(
    (index: number) => {
      const updated = files.filter((_, i) => i !== index);
      setFiles(updated);
      onFilesChange(updated);
    },
    [files, onFilesChange]
  );

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    addFiles(e.dataTransfer.files);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) {
      addFiles(e.target.files);
      // Reset input so the same file can be re-selected
      e.target.value = "";
    }
  }

  const isFull = files.length >= MAX_FILES;

  return (
    <div className="space-y-3">
      <label className="text-[11px] font-bold uppercase tracking-[0.12em] text-gray-7 block">
        Attachments — optional
      </label>

      {/* Drop zone */}
      {!isFull && (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => inputRef.current?.click()}
          className={`relative flex items-center justify-center gap-2 px-4 py-5 rounded-xl border border-dashed cursor-pointer transition-all ${
            isDragging
              ? "border-ruby-9/40 bg-ruby-9/[0.04]"
              : "border-white/[0.06] bg-white/[0.03] hover:border-white/[0.12] hover:bg-white/[0.05]"
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            multiple
            onChange={handleInputChange}
            className="hidden"
          />
          <svg
            className="text-gray-7 shrink-0"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
          <span className="text-[13px] text-gray-8">
            {processing
              ? "Processing..."
              : `Drop PDF or images here (max ${MAX_FILES})`}
          </span>
        </div>
      )}

      {/* File pills */}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {files.map((file, i) => (
            <div
              key={`${file.name}-${i}`}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.06] text-[12px]"
            >
              <span className="text-gray-10 truncate max-w-[160px]">
                {file.name}
              </span>
              <span className="text-gray-7 shrink-0">
                {formatSize(file.size)}
              </span>
              <button
                type="button"
                onClick={() => removeFile(i)}
                className="text-gray-7 hover:text-ruby-11 transition-colors ml-0.5 shrink-0"
                aria-label={`Remove ${file.name}`}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
