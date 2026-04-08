"use client";

import { memo, useState } from "react";
import { AlertTriangle, Brain, ChevronDown } from "lucide-react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { MarkdownViewer } from "@/components/chat/markdown-viewer";
import { useTypewriter } from "@/hooks/chat/use-typewriter";
import { useI18n } from "@/hooks/use-i18n";
import { cn } from "@/lib/utils";

export const TypingTextBlock = memo<{
  content: string;
  typingEnabled: boolean;
}>(function TypingTextBlock({ content, typingEnabled }) {
  const { displayed } = useTypewriter(content ?? "", typingEnabled);

  return (
    <MarkdownViewer
      content={displayed}
      className="chat-markdown chat-markdown-assistant"
    />
  );
});

export const ThoughtBlock = memo<{ content?: string; cost?: string }>(
  function ThoughtBlock({ content, cost }) {
    const [isOpen, setIsOpen] = useState(false);
    const t = useI18n("chat");

    return (
      <Collapsible open={isOpen} onOpenChange={setIsOpen} className="w-full group">
        <CollapsibleTrigger asChild>
          <div className="flex items-center gap-2 cursor-pointer select-none mb-2">
            <div
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-mono transition-all border",
                isOpen
                  ? "bg-zinc-900 text-zinc-100 border-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-200"
                  : "bg-muted/30 text-muted-foreground border-transparent hover:bg-muted/50 hover:border-border",
              )}
            >
              <Brain size={12} className={cn(!cost && !isOpen && "animate-pulse")} />
              <span>{cost ? t("thought.withCost", { cost }) : t("thought.label")}</span>
              <ChevronDown
                size={12}
                className={cn("transition-transform duration-200", !isOpen && "-rotate-90")}
              />
            </div>
            {!isOpen ? <div className="h-px flex-1 bg-border/50" /> : null}
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="relative rounded-lg overflow-hidden bg-[#1e1e1e] dark:bg-[#0d0d0d] border border-zinc-800 shadow-inner">
            <div className="absolute top-0 left-0 right-0 h-6 bg-white/5 flex items-center px-2 gap-1.5">
              <div className="w-2 h-2 rounded-full bg-red-500/50" />
              <div className="w-2 h-2 rounded-full bg-yellow-500/50" />
              <div className="w-2 h-2 rounded-full bg-green-500/50" />
            </div>
            <div className="p-4 pt-8 text-xs font-mono text-zinc-400 whitespace-pre-wrap leading-relaxed overflow-x-auto">
              {content || <span className="animate-pulse">Thinking...</span>}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
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

export const ErrorMessageBlock = memo<{ message?: string }>(
  function ErrorMessageBlock({ message }) {
    const t = useI18n("chat");
    return (
      <div className="rounded-lg border border-red-200 bg-red-50/60 p-3 text-sm dark:border-red-900 dark:bg-red-900/20">
        <div className="mb-1 flex items-center gap-2 font-semibold text-red-700 dark:text-red-300">
          <AlertTriangle size={14} />
          <span>{t("error.requestFailed")}</span>
        </div>
        <div className="text-xs text-red-700/90 dark:text-red-200/90">
          {message || t("error.title")}
        </div>
      </div>
    );
  },
);
