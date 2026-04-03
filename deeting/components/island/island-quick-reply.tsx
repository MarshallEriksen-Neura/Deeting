"use client";

import { useCallback, useState } from "react";
import { SendHorizontal } from "lucide-react";
import { motion } from "framer-motion";

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
  const [justSent, setJustSent] = useState(false);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const text = value.trim();
      if (!text || disabled) return;
      await onSend?.(text);
      setValue("");
      setJustSent(true);
      setTimeout(() => setJustSent(false), 400);
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
          "border border-island-shell-border/40",
          "text-foreground placeholder:text-foreground/30",
          "focus:border-island-gold/60 focus:ring-1 focus:ring-[var(--island-gold-stroke-soft)]",
          "disabled:opacity-60 disabled:cursor-not-allowed",
          "transition-colors"
        )}
      />
      <motion.button
        type="submit"
        disabled={disabled || !value.trim()}
        animate={justSent ? { scale: [1, 1.2, 1] } : {}}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className={cn(
          "flex items-center justify-center w-8 h-8 rounded-full shrink-0",
          "bg-island-gold/15 text-island-gold",
          "hover:bg-island-gold/25",
          "disabled:opacity-30 disabled:cursor-not-allowed",
          "transition-colors"
        )}
      >
        <SendHorizontal className="w-3.5 h-3.5" />
      </motion.button>
    </form>
  );
}
