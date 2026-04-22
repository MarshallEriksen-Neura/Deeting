"use client";

import { useEffect, useReducer, useRef } from "react";
import { ChevronDown, Loader2, Terminal } from "lucide-react";

import { Collapsible, CollapsibleContent } from "@/ui/shadcn/collapsible";
import { cn } from "@/lib/utils";
import type { MessageBlock } from "@/lib/chat/message-protocol";

export function ExecutionConsole({
  blocks,
  isActive,
  showSandboxLabel,
  title,
}: {
  blocks: MessageBlock[];
  isActive: boolean;
  showSandboxLabel: boolean;
  title: string;
}) {
  const [isExpanded, dispatchExpanded] = useReducer(
    (state: boolean, action: "toggle" | "expand") =>
      action === "expand" ? true : !state,
    isActive,
  );
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isActive) dispatchExpanded("expand");
  }, [isActive]);

  useEffect(() => {
    if (isActive && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [blocks.length, isActive]);

  return (
    <div className="w-full max-w-2xl my-2 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800 shadow-sm bg-zinc-50 dark:bg-zinc-950 text-left">
      <div
        className="flex items-center justify-between px-3 py-2 bg-zinc-100 dark:bg-zinc-900 cursor-pointer border-b border-zinc-200 dark:border-zinc-800"
        onClick={() => dispatchExpanded("toggle")}
      >
        <div className="flex items-center gap-2">
          <Terminal size={14} className="text-zinc-500" />
          <span className="text-xs font-mono font-bold text-zinc-600 dark:text-zinc-400">
            {showSandboxLabel ? "SANDBOX EXECUTION" : title}
          </span>
          {isActive ? (
            <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
          ) : null}
        </div>
        <ChevronDown
          size={14}
          className={cn(
            "text-zinc-400 transition-transform duration-200",
            !isExpanded && "-rotate-90",
          )}
        />
      </div>

      <Collapsible open={isExpanded}>
        <CollapsibleContent>
          <div
            ref={scrollRef}
            className="p-3 max-h-[300px] overflow-y-auto font-mono text-[11px] leading-relaxed"
          >
            {blocks.map((block, i) => {
              if (block.type === "execution_section") {
                return null;
              }
              if (block.type === "console_log") {
                const isError = block.stream === "stderr";
                return (
                  <div
                    key={i}
                    className={cn(
                      "whitespace-pre-wrap break-all",
                      isError
                        ? "text-red-500"
                        : "text-zinc-600 dark:text-zinc-400",
                    )}
                  >
                    <span className="opacity-30 mr-2 select-none">|</span>
                    {block.content}
                  </div>
                );
              }
              return null;
            })}

            {isActive ? (
              <div className="flex items-center gap-1 mt-1 opacity-50 italic">
                <Loader2 size={10} className="animate-spin" />
                <span>Executing...</span>
              </div>
            ) : null}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
