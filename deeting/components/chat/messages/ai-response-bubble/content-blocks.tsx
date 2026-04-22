"use client";

import { memo, useState, useMemo } from "react";
import { AlertTriangle, Brain, ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/ui/shadcn/collapsible";
import { MarkdownViewer } from "@/components/chat/markdown-viewer";
import { useTypewriter } from "@/hooks/chat/use-typewriter";
import { useI18n } from "@/hooks/use-i18n";
import { cn } from "@/lib/utils";

export const TypingTextBlock = memo<{
  content: string;
  typingEnabled: boolean;
  messageId?: string;
  enableRunnableFences?: boolean;
}>(function TypingTextBlock({
  content,
  typingEnabled,
  messageId,
  enableRunnableFences = false,
}) {
  const { displayed } = useTypewriter(content ?? "", typingEnabled);

  return (
    <MarkdownViewer
      content={displayed}
      className="chat-markdown chat-markdown-assistant"
      messageId={messageId}
      enableRunnableFences={enableRunnableFences}
    />
  );
});

export const ThoughtBlock = memo<{ content?: string; cost?: string }>(
  function ThoughtBlock({ content, cost }) {
    const [isOpen, setIsOpen] = useState(false);
    const t = useI18n("chat");

    return (
      <div className="w-full group mb-2">
        <div 
          onClick={() => setIsOpen(!isOpen)}
          className={cn(
            "inline-flex items-center gap-2 px-2 py-1 rounded-full text-[11px] cursor-pointer transition-all border select-none",
            isOpen
              ? "bg-[var(--ink)] text-[var(--panel-bg)] border-[var(--ink)]"
              : "bg-transparent text-[var(--ink-3)] border-[var(--hairline)] hover:border-[var(--ink-2)]"
          )}
        >
          <Brain size={12} className={cn(!cost && !isOpen && "animate-pulse")} />
          <span className="font-medium uppercase tracking-wider">
            {cost ? t("thought.withCost", { cost }) : t("thought.label")}
          </span>
          <ChevronDown
            size={12}
            className={cn("transition-transform duration-200", !isOpen && "-rotate-90")}
          />
        </div>

        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="mt-2 p-4 rounded-xl bg-[var(--panel-bg)] border border-[var(--hairline)] text-[13px] font-mono text-[var(--ink-2)] whitespace-pre-wrap leading-relaxed">
                {content || <span className="animate-pulse">Thinking...</span>}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  },
);

export const CapabilityTransitionCard = memo<{
  action?: "activated" | "deactivated" | "updated";
  capabilityName?: string;
  reason?: string;
}>(function CapabilityTransitionCard({ action, capabilityName, reason }) {
  const title =
    action === "activated"
      ? `已启用专家能力：${capabilityName ?? ""}`.trim()
      : action === "deactivated"
        ? `已退出专家能力：${capabilityName ?? ""}`.trim()
        : `专家能力上下文已更新${capabilityName ? `：${capabilityName}` : ""}`;
  const accentClass =
    action === "activated"
      ? "border-sky-200 bg-sky-50/70 dark:border-sky-900 dark:bg-sky-900/20"
      : "border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-900/20";

  return (
    <div className={cn("rounded-lg border px-3 py-2 text-sm", accentClass)}>
      <div className="font-medium text-foreground">{title}</div>
      {reason ? <div className="mt-1 text-xs text-muted-foreground">{reason}</div> : null}
    </div>
  );
});

export const ErrorMessageBlock = memo<{ message?: string | object }>(
  function ErrorMessageBlock({ message }) {
    const t = useI18n("chat");
    const displayMessage = useMemo(() => {
      if (typeof message === "string") return message;
      if (typeof message === "object" && message !== null) {
        try {
          return JSON.stringify(message, null, 2);
        } catch (e) {
          return String(message);
        }
      }
      return "";
    }, [message]);

    return (
      <div className="rounded-xl border border-red-200 bg-red-50/60 p-4 text-sm dark:border-red-900 dark:bg-red-900/20">
        <div className="mb-2 flex items-center gap-2 font-bold uppercase tracking-wider text-red-700 dark:text-red-400">
          <AlertTriangle size={14} />
          <span className="text-[11px] font-bold">{t("error.requestFailed")}</span>
        </div>
        <div className="text-[13px] font-mono text-red-700/90 dark:text-red-200/90 whitespace-pre-wrap leading-relaxed">
          {displayMessage || t("error.title")}
        </div>
      </div>
    );
  },
);
