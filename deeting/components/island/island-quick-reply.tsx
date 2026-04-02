"use client";

import { useCallback, useState } from "react";
import { SendHorizontal } from "lucide-react";

import { cn } from "@/lib/utils";

interface IslandQuickReplyProps {
  onSend?: (text: string) => void | Promise<void>;
  placeholder?: string;
  disabled?: boolean;
}

export function IslandQuickReply({
  onSend,
  placeholder = "Quick reply…",
  disabled = false,
}: IslandQuickReplyProps) {
  const [value, setValue] = useState("");

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const text = value.trim();
      if (!text || disabled) return;
      await onSend?.(text);
      setValue("");
    },
    [value, onSend, disabled]
  );

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <input
        type="text"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={cn(
          "flex-1 h-8 px-3 text-[12px] rounded-full outline-none",
          "bg-white/60 dark:bg-white/8",
          "border border-[var(--island-shell-border)]/40",
          "text-[var(--foreground)] placeholder:text-[var(--foreground)]/30",
          "focus:border-[var(--island-gold-stroke)]/60 focus:ring-1 focus:ring-[var(--island-gold-stroke-soft)]",
          "disabled:opacity-60 disabled:cursor-not-allowed",
          "transition-colors"
        )}
      />
      <button
        type="submit"
        disabled={disabled || !value.trim()}
        className={cn(
          "flex items-center justify-center w-8 h-8 rounded-full shrink-0",
          "bg-[var(--island-gold-stroke)]/15 text-[var(--island-gold-stroke)]",
          "hover:bg-[var(--island-gold-stroke)]/25",
          "disabled:opacity-30 disabled:cursor-not-allowed",
          "transition-colors"
        )}
      >
        <SendHorizontal className="w-3.5 h-3.5" />
      </button>
    </form>
  );
}
