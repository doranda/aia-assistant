"use client";

import { useState, useRef } from "react";

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function handleSubmit() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function handleInput() {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 150) + "px";
    }
  }

  return (
    <div className="border-t border-transparent" style={{ borderImage: "linear-gradient(90deg,transparent,rgba(255,255,255,0.06),transparent) 1" }}>
      <div className="pt-4 pb-6 lg:pb-8">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => { setValue(e.target.value); handleInput(); }}
          onKeyDown={handleKeyDown}
          placeholder="Ask about products, underwriting, claims, or compliance…"
          disabled={disabled}
          rows={1}
          className="w-full px-5 py-4 rounded-[8px] border border-white/[0.08] bg-[#18181B] text-[15px] text-[#FAFAFA] font-sans placeholder:text-[#52525B] outline-none resize-none transition-all focus:border-[#D71920]/40 focus:shadow-[0_0_0_3px_rgba(215,25,32,0.08)] min-h-[52px]"
        />
        <div className="flex justify-between items-center mt-2 px-1">
          <span className="text-[11px] text-[#52525B]">
            {disabled ? (
              <span className="flex items-center gap-2">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#D71920] animate-pulse" />
                Searching documents &amp; generating response…
              </span>
            ) : (
              "↵ Send · Shift+↵ New line · Sources cited inline"
            )}
          </span>
          <button
            onClick={handleSubmit}
            disabled={!value.trim() || disabled}
            className="text-[13px] text-white font-semibold px-5 py-2 rounded-[6px] bg-[#D71920] hover:bg-[#B51218] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {disabled ? "Thinking…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
