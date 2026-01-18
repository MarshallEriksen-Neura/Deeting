"use client";

import { useEffect, useMemo, useState } from "react";
import { Brain, Check, ChevronDown, ChevronRight, Loader2, Terminal } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { StatusPill } from "@/components/ui/status-pill";
import { cn } from "@/lib/utils";
import { resolveStatusDetail } from "@/lib/chat/status-detail";
import { useI18n } from "@/hooks/use-i18n";
import type { MessageBlock } from "@/lib/chat/message-protocol";
import { MarkdownViewer } from "@/components/chat/markdown-viewer";

interface AIResponseBubbleProps {
  parts: MessageBlock[];
  isActive?: boolean;
  streamEnabled?: boolean;
  reveal?: boolean;
  statusStage?: string | null;
  statusCode?: string | null;
  statusMeta?: Record<string, unknown> | null;
}

export function AIResponseBubble({
  parts,
  isActive = false,
  streamEnabled = false,
  reveal = false,
  statusStage = null,
  statusCode = null,
  statusMeta = null,
}: AIResponseBubbleProps) {
  const t = useI18n("chat");
  const steps = useMemo(
    () => [
      { key: "listen", label: t("status.flow.listen") },
      { key: "remember", label: t("status.flow.remember") },
      { key: "evolve", label: t("status.flow.evolve") },
      { key: "render", label: t("status.flow.render") },
    ],
    [t]
  );
  const timerStep = useStepProgress(isActive && !statusStage, steps.length);
  const activeStep = statusStage ? resolveStageIndex(statusStage, steps) : timerStep;
  const hasContent = parts.length > 0;
  const enableReveal = reveal && !streamEnabled;
  let revealIndex = 0;

  const nextRevealClass = () => {
    if (!enableReveal) return "";
    revealIndex += 1;
    return cn("animate-glass-card-in", getStaggerClass(revealIndex));
  };

  return (
    <div className="flex flex-col gap-2 w-full items-start">
      <div
        className={cn(
          "w-full max-w-[80%] rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed",
          "bg-white/80 dark:bg-white/5 border border-black/5 dark:border-white/10",
          "shadow-[0_6px_20px_-12px_rgba(15,23,42,0.2)] backdrop-blur-md"
        )}
        data-slot="glass-card"
      >
        {isActive && (
          <StatusStream
            steps={steps}
            activeIndex={activeStep}
            compact={hasContent}
            label={streamEnabled ? t("status.flow.stream") : t("status.flow.batch")}
            detail={resolveStatusDetail(t, statusCode, statusMeta)}
          />
        )}

        {hasContent ? (
          <div className={cn("space-y-3", isActive && "mt-3")}>
            {parts.map((part, index) => {
              // --- A. 思维链 (CoT) ---
              if (part.type === 'thought') {
                return (
                  <div key={index} className={nextRevealClass()}>
                    <ThoughtBlock content={part.content} cost={part.cost} />
                  </div>
                );
              }

              // --- B. MCP 工具调用 ---
              if (part.type === 'tool_call') {
                return (
                  <div key={index} className={nextRevealClass()}>
                    <ToolCallBlock 
                      name={part.toolName} 
                      args={part.toolArgs} 
                      status={part.status} 
                    />
                  </div>
                );
              }

              // --- C. 普通文本 ---
              if (!part.content?.trim()) return null;

              return (
                <div key={index} className={nextRevealClass()}>
                  <MarkdownViewer
                    content={part.content}
                    className="chat-markdown chat-markdown-assistant"
                  />
                </div>
              );
            })}

            {isActive && streamEnabled && <GhostCursor />}
          </div>
        ) : (
          <ConstructingPlaceholder
            label={streamEnabled ? t("status.placeholder.stream") : t("status.placeholder.batch")}
          />
        )}
      </div>
    </div>
  );
}

function StatusStream({
  steps,
  activeIndex,
  compact,
  label,
  detail,
}: {
  steps: Array<{ key: string; label: string }>;
  activeIndex: number;
  compact?: boolean;
  label: string;
  detail?: string | null;
}) {
  const remembering = steps[activeIndex]?.key === "remember";

  return (
    <div
      className={cn(
        "rounded-xl border border-black/5 dark:border-white/10 bg-white/70 dark:bg-white/5",
        "px-3 py-2 backdrop-blur-sm",
        compact ? "text-[10px]" : "text-xs",
        remembering && "bg-blue-50/60 dark:bg-blue-500/10"
      )}
    >
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>{label}</span>
      </div>
      <div className={cn("mt-2 flex flex-col", compact ? "gap-1" : "gap-1.5")}>
        {steps.map((step, index) => {
          const done = index < activeIndex;
          const active = index === activeIndex;
          return (
            <div key={step.key} className="flex items-center gap-2 text-muted-foreground">
              {done ? (
                <Check className="w-3 h-3 text-emerald-500" />
              ) : active ? (
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-blue-500/40 animate-ping"></span>
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-blue-500/80"></span>
                </span>
              ) : (
                <span className="h-2 w-2 rounded-full bg-muted-foreground/30" />
              )}
              <span className={cn(active ? "text-foreground" : "text-muted-foreground/70")}>
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
      {detail ? (
        <div className="mt-2">
          <StatusPill text={detail} tone="subtle" isLoading={activeIndex === 2} />
        </div>
      ) : null}
    </div>
  );
}

function ConstructingPlaceholder({ label }: { label: string }) {
  return (
    <div className="mt-3 rounded-xl border border-black/5 dark:border-white/10 bg-white/70 dark:bg-white/5 px-3 py-3 backdrop-blur-sm relative overflow-hidden">
      <div className="absolute inset-0 glass-shimmer opacity-70" aria-hidden />
      <div className="relative z-10 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full rounded-full bg-blue-500/35 animate-ping"></span>
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-500/70"></span>
        </span>
        <span>{label}</span>
      </div>
      <div className="relative z-10 mt-3 space-y-2">
        <div className="h-2.5 rounded-full bg-black/5 dark:bg-white/5" />
        <div className="h-2.5 w-5/6 rounded-full bg-black/5 dark:bg-white/5" />
      </div>
    </div>
  );
}

function GhostCursor() {
  return (
    <span className="inline-flex items-end gap-1 text-muted-foreground/70">
      <span className="inline-flex w-2.5 h-4 rounded-sm bg-blue-500/70 dark:bg-blue-400/70 shadow-[0_0_12px_rgba(37,99,235,0.35)] animate-pulse" />
    </span>
  );
}

function useStepProgress(isActive: boolean, stepCount: number) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!isActive || stepCount <= 1) {
      setIndex(0);
      return;
    }

    let current = 0;
    setIndex(0);
    const delays = [700, 1100, 1400, 900];
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = (delay: number) => {
      timer = setTimeout(() => {
        current = Math.min(current + 1, stepCount - 1);
        setIndex(current);
        if (current < stepCount - 1) {
          schedule(delays[current] ?? 1200);
        }
      }, delay);
    };

    schedule(delays[0] ?? 900);

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [isActive, stepCount]);

  return index;
}

function resolveStageIndex(stage: string, steps: Array<{ key: string }>) {
  const idx = steps.findIndex((step) => step.key === stage);
  return idx >= 0 ? idx : 0;
}

function getStaggerClass(index: number) {
  const capped = Math.min(Math.max(index, 1), 10);
  return `stagger-${capped}`;
}

// === 组件：思维链折叠块 ===
function ThoughtBlock({ content, cost }: { content?: string, cost?: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const t = useI18n("chat");

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="w-full">
      <CollapsibleTrigger asChild>
        <div className="flex items-center gap-2 cursor-pointer group select-none">
           <div className={cn(
             "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
             isOpen ? "bg-muted text-foreground" : "bg-muted/50 text-muted-foreground hover:bg-muted"
           )}>
             <Brain size={12} className={cn(!cost && "animate-pulse")} /> 
             <span>{cost ? t("thought.withCost", { cost }) : t("thought.label")}</span>
             {isOpen ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}
           </div>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 ml-2 pl-4 border-l-2 border-border text-xs text-muted-foreground font-mono whitespace-pre-wrap leading-relaxed">
          {content || t("thought.loading")}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// === 组件：MCP 工具块 ===
function ToolCallBlock({ name, args, status }: { name?: string, args?: string, status?: string }) {
  const isRunning = status === 'running';
  const isError = status === 'error';

  return (
    <div className={cn(
      "flex items-center gap-3 p-3 rounded-lg border text-sm w-full max-w-md transition-all",
      isRunning ? "border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-900/20" : "border-border bg-card",
      isError && "border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-900/20"
    )}>
      {/* Icon Status */}
      <div className={cn(
        "w-8 h-8 rounded flex items-center justify-center shrink-0",
        isRunning ? "bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300" : "bg-muted text-muted-foreground",
        isError && "bg-red-100 text-red-500 dark:bg-red-900 dark:text-red-300"
      )}>
        {isRunning ? <Loader2 size={16} className="animate-spin"/> : <Terminal size={16}/>}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="font-semibold font-mono truncate">{name}</span>
          <Badge variant="outline" className="text-[10px] h-5 font-normal text-muted-foreground">
            MCP
          </Badge>
        </div>
        <div className="text-xs text-muted-foreground truncate font-mono mt-0.5 opacity-80">
          {args}
        </div>
      </div>

      {/* Result Indicator (Click to view details) */}
      {!isRunning && (
        <div className="text-muted-foreground cursor-pointer hover:text-foreground">
           <ChevronRight size={16} />
        </div>
      )}
    </div>
  );
}
