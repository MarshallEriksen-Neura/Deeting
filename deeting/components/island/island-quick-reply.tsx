"use client";

import { useCallback, useState } from "react";
import { MessageSquarePlus, SendHorizontal } from "lucide-react";
import { motion } from "framer-motion";

import { useI18n } from "@/hooks/use-i18n";
import { cn } from "@/lib/utils";

interface IslandQuickReplyProps {
  onSend?: (text: string) => void | Promise<void>;
  onNewConversation?: () => void | Promise<void>;
  placeholder?: string;
  disabled?: boolean;
}

export function IslandQuickReply({
  onSend,
  onNewConversation,
  placeholder,
  disabled = false,
}: IslandQuickReplyProps) {
  const t = useI18n("chat");
  const [value, setValue] = useState("");
  const [justSent, setJustSent] = useState(false);
  const [isStartingNewConversation, setIsStartingNewConversation] =
    useState(false);
  const resolvedPlaceholder = placeholder ?? t("island.quickReplyPlaceholder");

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
    [value, onSend, disabled],
  );

  const handleNewConversation = useCallback(async () => {
    if (disabled || isStartingNewConversation || !onNewConversation) return;
    setIsStartingNewConversation(true);
    try {
      await onNewConversation();
      setValue("");
    } finally {
      setIsStartingNewConversation(false);
    }
  }, [disabled, isStartingNewConversation, onNewConversation]);

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <input
        type="text"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={resolvedPlaceholder}
        disabled={disabled}
        className={cn(
          "h-10 flex-1 rounded-full px-4 text-[12px] outline-none",
          "border border-white/40 bg-white/62 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]",
          "text-foreground placeholder:text-foreground/34",
          "focus:border-island-gold/55 focus:ring-1 focus:ring-[var(--island-gold-stroke-soft)]",
          "dark:border-white/10 dark:bg-white/6",
          "disabled:cursor-not-allowed disabled:opacity-60",
          "transition-colors",
        )}
      />
      {onNewConversation ? (
        <motion.button
          type="button"
          onClick={() => void handleNewConversation()}
          disabled={disabled || isStartingNewConversation}
          whileTap={{ scale: 0.96 }}
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
            "border border-island-gold/18 bg-white/54 text-island-gold",
            "shadow-[0_10px_22px_-18px_rgba(0,0,0,0.32)] hover:bg-island-gold/12 hover:scale-[1.02]",
            "dark:border-white/10 dark:bg-white/6",
            "disabled:cursor-not-allowed disabled:opacity-35",
            "transition-colors",
          )}
          aria-label={t("island.newConversation")}
          title={t("island.newConversation")}
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
        </motion.button>
      ) : null}
      <motion.button
        type="submit"
        disabled={disabled || isStartingNewConversation || !value.trim()}
        animate={justSent ? { scale: [1, 1.14, 1] } : {}}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
          "bg-[linear-gradient(180deg,rgba(229,216,197,0.76),rgba(245,239,230,0.52))] text-island-gold",
          "shadow-[0_12px_24px_-18px_rgba(0,0,0,0.35)] hover:scale-[1.02]",
          "dark:bg-[linear-gradient(180deg,rgba(60,47,32,0.82),rgba(30,25,21,0.96))]",
          "disabled:cursor-not-allowed disabled:opacity-30",
          "transition-colors",
        )}
      >
        <SendHorizontal className="h-3.5 w-3.5" />
      </motion.button>
    </form>
  );
}
