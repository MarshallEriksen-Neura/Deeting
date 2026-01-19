"use client";

import { useMemo, useState } from "react";
import { Brain, ChevronDown, ChevronRight, Loader2, Terminal } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { resolveStatusDetail } from "@/lib/chat/status-detail";
import { useI18n } from "@/hooks/use-i18n";
import type { MessageBlock } from "@/lib/chat/message-protocol";
import { MarkdownViewer } from "@/components/chat/markdown-viewer";
import { motion, AnimatePresence } from "framer-motion";
import { 
  StatusStream, 
  HolographicPulse, 
  GhostCursor, 
  useStepProgress, 
  resolveStageIndex 
} from "./status-visuals";

interface AIResponseBubbleProps {
  parts: MessageBlock[];
  isActive?: boolean;
  streamEnabled?: boolean;
  statusStage?: string | null;
  statusCode?: string | null;
  statusMeta?: Record<string, unknown> | null;
  reveal?: boolean;
}

export function AIResponseBubble({
  parts,
  isActive = false,
  streamEnabled = false,
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
  
  // Animation variants
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
        delayChildren: 0.1
      }
    }
  };

  const itemVariants = {
    hidden: { y: 10, opacity: 0 },
    visible: { 
      y: 0, 
      opacity: 1,
      transition: { type: "spring", stiffness: 100, damping: 15 }
    }
  };

  return (
    <div className="flex flex-col gap-2 w-full items-start">
      <div
        className={cn(
          "w-full max-w-[92%] rounded-2xl rounded-tl-sm px-1 py-1 text-sm leading-relaxed",
          "bg-white/90 dark:bg-white/5 border border-slate-200/80 dark:border-white/10 text-foreground",
          "shadow-[0_4px_20px_-6px_rgba(15,23,42,0.18)] backdrop-blur-md overflow-hidden"
        )}
        data-slot="glass-card"
      >
        <div className="px-4 py-3">
            {isActive && (
            <div className="mb-3">
                <StatusStream
                steps={steps}
                activeIndex={activeStep}
                compact={hasContent}
                label={streamEnabled ? t("status.flow.stream") : t("status.flow.batch")}
                detail={resolveStatusDetail(t, statusCode, statusMeta)}
                />
            </div>
            )}

            <AnimatePresence mode="wait">
            {!hasContent ? (
                <motion.div
                key="placeholder"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                >
                <HolographicPulse
                    label={streamEnabled ? t("status.placeholder.stream") : t("status.placeholder.batch")} 
                />
                </motion.div>
            ) : (
                <motion.div
                key="content"
                className="space-y-3"
                variants={!streamEnabled ? containerVariants : {}}
                initial={!streamEnabled ? "hidden" : "visible"}
                animate="visible"
                >
                {parts.map((part, index) => {
                    // --- A. 思维链 (CoT) ---
                    if (part.type === 'thought') {
                    return (
                        <motion.div key={`thought-${index}`} variants={itemVariants}>
                        <ThoughtBlock content={part.content} cost={part.cost} />
                        </motion.div>
                    );
                    }

                    // --- B. MCP 工具调用 ---
                    if (part.type === 'tool_call') {
                    return (
                        <motion.div key={`tool-${index}`} variants={itemVariants}>
                        <ToolCallBlock 
                            name={part.toolName} 
                            args={part.toolArgs} 
                            status={part.status} 
                        />
                        </motion.div>
                    );
                    }

                    // --- C. 普通文本 ---
                    if (!part.content?.trim()) return null;

                    return (
                    <motion.div key={`text-${index}`} variants={itemVariants}>
                        <MarkdownViewer
                        content={part.content}
                        className="chat-markdown chat-markdown-assistant"
                        />
                    </motion.div>
                    );
                })}

                {isActive && streamEnabled && (
                    <motion.div variants={itemVariants}>
                        <GhostCursor />
                    </motion.div>
                )}
                </motion.div>
            )}
            </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

// === 组件：思维链折叠块 (Terminal Style) ===
function ThoughtBlock({ content, cost }: { content?: string, cost?: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const t = useI18n("chat");

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="w-full group">
      <CollapsibleTrigger asChild>
        <div className="flex items-center gap-2 cursor-pointer select-none mb-2">
           <div className={cn(
             "flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-mono transition-all border",
             isOpen 
                ? "bg-zinc-900 text-zinc-100 border-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-200" 
                : "bg-muted/30 text-muted-foreground border-transparent hover:bg-muted/50 hover:border-border"
           )}>
             <Brain size={12} className={cn(!cost && !isOpen && "animate-pulse")} /> 
             <span>{cost ? t("thought.withCost", { cost }) : t("thought.label")}</span>
             <ChevronDown size={12} className={cn("transition-transform duration-200", !isOpen && "-rotate-90")} />
           </div>
           {!isOpen && (
               <div className="h-px flex-1 bg-border/50" />
           )}
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