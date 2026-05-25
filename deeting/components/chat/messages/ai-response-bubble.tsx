"use client";

import { memo, useMemo, type ComponentProps } from "react";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import { GhostCursor } from "@/components/chat/visuals/status-visuals";
import type {
  MessageBlock,
  UIBlock as MessageUIBlock,
  ToolCallBlock as MessageToolCallBlock,
  ToolResultBlock as MessageToolResultBlock,
} from "@/lib/chat/message-protocol";
import { cn } from "@/lib/utils";
import {
  AIResponseStatusRail,
  AIResponseStreamingTail,
} from "@/components/chat/messages/ai-response-bubble/status-rail";
import { ExecutionConsole } from "@/components/chat/messages/ai-response-bubble/execution-console";
import {
  CapabilityTransitionCard,
  ErrorMessageBlock,
  ThoughtBlock,
  TypingTextBlock,
} from "@/components/chat/messages/ai-response-bubble/content-blocks";
import {
  ToolCallBlock,
  ToolCallGroup,
  ToolResultBlock,
} from "@/components/chat/messages/ai-response-bubble/tool-blocks";
import { DitingThinkPanel } from "@/components/chat/messages/ai-response-bubble/diting-think-panel";

const ViewBlock = dynamic(() => import("@/components/views/view-block"), {
  ssr: false,
});

function isInlineSnippetToolBlock(block: MessageBlock): boolean {
  return (
    (block.type === "tool_call" || block.type === "tool_result") &&
    block.toolName === "run_local_code_snippet"
  )
}

function getRenderableBlockContent(block: MessageBlock): string | null {
  if ("content" in block && typeof block.content === "string") {
    return block.content;
  }
  return null;
}

function serializeComparableBlock(block: MessageBlock) {
  switch (block.type) {
    case "text":
    case "thought":
      return {
        type: block.type,
        content: block.content,
        cost: "cost" in block ? block.cost : undefined,
      };
    case "capability_transition":
      return {
        type: block.type,
        action: block.action,
        capabilityId: block.capabilityId,
        capabilityName: block.capabilityName,
        reason: block.reason,
      };
    case "tool_call":
      return {
        type: block.type,
        toolName: block.toolName,
        toolArgs: block.toolArgs,
        callId: block.callId,
        status: block.status,
      };
    case "tool_result":
      return {
        type: block.type,
        toolName: block.toolName,
        callId: block.callId,
        status: block.status,
        result: block.result,
        debug: block.debug,
      };
    case "console_log":
      return {
        type: block.type,
        content: block.content,
        stream: block.stream,
      };
    case "execution_section":
      return { type: block.type, title: block.title };
    case "flight_offer":
    case "file_preview":
      return { type: block.type, data: block.data };
    case "error":
      return { type: block.type, message: block.message };
    case "diting_think_frame":
      return {
        type: block.type,
        intent: block.intent,
        facts: block.facts,
        assumptions: block.assumptions,
        verificationTargets: block.verificationTargets,
        rules: block.rules,
      };
    case "ui":
      return {
        type: block.type,
        toolName: block.toolName,
        callId: block.callId,
        title: block.title,
        viewType: block.viewType,
        payload: block.payload,
        metadata: block.metadata,
      };
    default:
      return null;
  }
}

interface AIResponseBubbleProps {
  messageId?: string;
  parts: MessageBlock[];
  isActive?: boolean;
  streamEnabled?: boolean;
  typingEnabled?: boolean;
  statusStage?: string | null;
  statusCode?: string | null;
  statusMeta?: Record<string, unknown> | null;
}

export const AIResponseBubble = memo<AIResponseBubbleProps>(
  function AIResponseBubble({
    messageId,
    parts,
    isActive = false,
    streamEnabled = false,
    typingEnabled = false,
    statusStage = null,
    statusCode = null,
    statusMeta = null,
  }) {
    const hasContent = useMemo(() => parts.length > 0, [parts.length]);

    // For the status rail we only care about user-visible *answer* content
    // (text / thoughts / errors / inline UI). Tool calls and intermediate
    // execution blocks should NOT silence the loading indicator — otherwise
    // the rail vanishes the instant a tool fires and the user is left with
    // no feedback while the model is still working between turns.
    const hasAnswerContent = useMemo(
      () =>
        parts.some((part) => {
          if (part.type === "text" || part.type === "thought") {
            return typeof part.content === "string" && part.content.trim().length > 0;
          }
          if (part.type === "error") return true;
          if (part.type === "ui") return true;
          return false;
        }),
      [parts],
    );

    const { resultMap, pairedResultIndices } = useMemo(() => {
      const map = new Map<string, MessageToolResultBlock>();
      const paired = new Set<number>();
      parts.forEach((part, index) => {
        if (isInlineSnippetToolBlock(part)) return;
        if (part.type === "tool_result" && part.callId) {
          map.set(part.callId, part);
          if (parts.some((p) => p.type === "tool_call" && p.callId === part.callId)) {
            paired.add(index);
          }
        }
      });
      return { resultMap: map, pairedResultIndices: paired };
    }, [parts]);

    const dittingFrameBlock = useMemo(() => {
      for (const part of parts) {
        if (part.type === "diting_think_frame") {
          return part;
        }
      }
      return null;
    }, [parts]);

    const hasContradictedFrame = useMemo(() => {
      if (!dittingFrameBlock) return false;
      for (const part of parts) {
        if (part.type !== "tool_result") continue;
        const debug =
          part.debug && typeof part.debug === "object"
            ? (part.debug as Record<string, unknown>)
            : null;
        if (!debug) continue;
        const traceBlocks = debug.tool_trace_blocks;
        if (!Array.isArray(traceBlocks)) continue;
        for (const block of traceBlocks) {
          if (!block || typeof block !== "object") continue;
          const blockRecord = block as Record<string, unknown>;
          if (blockRecord.type !== "runtime_transition_correlation") continue;
          const payload = blockRecord.payload;
          if (!payload || typeof payload !== "object") continue;
          const outcome = (payload as Record<string, unknown>).outcome;
          if (outcome === "contradicted") return true;
        }
      }
      return false;
    }, [dittingFrameBlock, parts]);

    const { uiBlocksByCallId, pairedUiIndices, hasCallLinkedUi } = useMemo(() => {
      const toolCallIds = new Set<string>();
      const map = new Map<string, MessageUIBlock[]>();
      const paired = new Set<number>();
      let hasLinkedUi = false;

      parts.forEach((part) => {
        if (isInlineSnippetToolBlock(part)) return;
        if (
          part.type === "tool_call" &&
          typeof part.callId === "string" &&
          part.callId.trim().length > 0
        ) {
          toolCallIds.add(part.callId.trim());
        }
      });

      parts.forEach((part, index) => {
        if (part.type !== "ui") return;
        const callId = typeof part.callId === "string" ? part.callId.trim() : "";
        if (!callId || !toolCallIds.has(callId)) return;

        hasLinkedUi = true;
        paired.add(index);
        const existing = map.get(callId) ?? [];
        existing.push(part);
        map.set(callId, existing);
      });

      return {
        uiBlocksByCallId: map,
        pairedUiIndices: paired,
        hasCallLinkedUi: hasLinkedUi,
      };
    }, [parts]);

    const { shouldGroupTools, toolCallEntries, firstToolCallIndex } = useMemo(() => {
      const trailingEntries: Array<{ part: MessageToolCallBlock; index: number }> = [];

      for (let idx = parts.length - 1; idx >= 0; idx -= 1) {
        const part = parts[idx];
        if (isInlineSnippetToolBlock(part)) {
          break;
        }
        if (part.type !== "tool_call") {
          break;
        }
        if (part.status !== "running" && part.status !== "requires_approval") {
          break;
        }
        trailingEntries.unshift({ part, index: idx });
      }

      return {
        shouldGroupTools: isActive && trailingEntries.length > 1,
        toolCallEntries: trailingEntries,
        firstToolCallIndex:
          trailingEntries.length > 0 ? trailingEntries[0].index : -1,
      };
    }, [parts, isActive]);

    const shouldRevealCallChain = useMemo(() => {
      if (hasContent) return true;
      if (toolCallEntries.length > 0) return true;
      if (statusStage && statusStage !== "listen") return true;
      return false;
    }, [hasContent, statusStage, toolCallEntries.length]);

    const hasToolActivity = useMemo(
      () =>
        toolCallEntries.length > 0 ||
        pairedResultIndices.size > 0 ||
        hasCallLinkedUi,
      [hasCallLinkedUi, pairedResultIndices.size, toolCallEntries.length],
    );
    const enableRunnableFences = true;

    const consoleTitle = useMemo(() => {
      for (const part of parts) {
        if (part.type === "execution_section") {
          const title = typeof part.title === "string" ? part.title.trim() : "";
          if (title) return title;
        }
      }
      return "Code Execution";
    }, [parts]);

    const shouldShowSandboxLabelForConsole = (nextPartIndex: number) => {
      const nextPart = parts[nextPartIndex];
      if (!nextPart) return false;
      if (nextPart.type !== "tool_call" && nextPart.type !== "tool_result") {
        return false;
      }
      return nextPart.toolName === "execute_code_plan";
    };

    return (
      <div
        className={cn(
          "w-full max-w-full text-[15px] leading-relaxed",
          "border-l-[3px] border-l-primary/25 dark:border-l-primary/35",
          "text-foreground overflow-hidden",
        )}
        data-slot="glass-card"
      >
        <div className="pl-4 pr-1 py-2 min-w-0 overflow-hidden">
          <AIResponseStatusRail
            isActive={isActive}
            hasContent={hasAnswerContent}
            hasToolActivity={hasToolActivity}
            statusStage={statusStage}
            statusCode={statusCode}
            statusMeta={statusMeta}
            streamEnabled={streamEnabled}
            shouldRevealCallChain={shouldRevealCallChain}
          />

          {dittingFrameBlock ? (
            <DitingThinkPanel
              block={dittingFrameBlock}
              contradicted={hasContradictedFrame}
            />
          ) : null}

          {(hasContent || hasToolActivity) && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="space-y-3"
            >
              {parts.map((part, index) => {
                if (part.type === "diting_think_frame") {
                  return null;
                }
                if (part.type === "thought") {
                  return (
                    <AnimatedBlock key={`thought-${index}`}>
                      <ThoughtBlock content={part.content} cost={part.cost} />
                    </AnimatedBlock>
                  );
                }

                if (part.type === "capability_transition") {
                  return (
                    <AnimatedBlock key={`capability-transition-${index}`}>
                      <CapabilityTransitionCard
                        action={part.action}
                        capabilityName={part.capabilityName}
                        reason={part.reason}
                      />
                    </AnimatedBlock>
                  );
                }

                if (part.type === "tool_call") {
                  if (isInlineSnippetToolBlock(part)) {
                    return null;
                  }
                  if (shouldGroupTools) {
                    if (index < firstToolCallIndex) {
                      return (
                        <AnimatedBlock key={`tool-${index}`}>
                          <ToolCallBlock
                            messageId={messageId}
                            callId={part.callId}
                            name={part.toolName}
                            args={part.toolArgs}
                            status={part.status}
                            resultBlock={part.callId ? resultMap.get(part.callId) : undefined}
                            uiBlocks={part.callId ? uiBlocksByCallId.get(part.callId) : undefined}
                          />
                        </AnimatedBlock>
                      );
                    }
                    if (index === firstToolCallIndex) {
                      return (
                        <AnimatedBlock key="tool-group">
                          <ToolCallGroup
                            messageId={messageId}
                            toolCalls={toolCallEntries}
                            resultMap={resultMap}
                            uiBlocksByCallId={uiBlocksByCallId}
                            isActive={isActive}
                          />
                        </AnimatedBlock>
                      );
                    }
                    return null;
                  }

                  return (
                    <AnimatedBlock key={`tool-${index}`}>
                      <ToolCallBlock
                        messageId={messageId}
                        callId={part.callId}
                        name={part.toolName}
                        args={part.toolArgs}
                        status={part.status}
                        resultBlock={part.callId ? resultMap.get(part.callId) : undefined}
                        uiBlocks={part.callId ? uiBlocksByCallId.get(part.callId) : undefined}
                      />
                    </AnimatedBlock>
                  );
                }

                if (part.type === "tool_result") {
                  if (isInlineSnippetToolBlock(part)) return null;
                  if (pairedResultIndices.has(index)) return null;
                  return (
                    <AnimatedBlock key={`tool-result-${index}`}>
                      <ToolResultBlock
                        name={part.toolName}
                        callId={part.callId}
                        status={part.status}
                        result={part.result}
                        debug={part.debug}
                      />
                    </AnimatedBlock>
                  );
                }

                if (part.type === "ui") {
                  if (pairedUiIndices.has(index)) return null;
                  return (
                    <AnimatedBlock key={`ui-${index}`}>
                      <ViewBlock
                        viewType={part.viewType}
                        payload={part.payload}
                        title={part.title}
                        metadata={part.metadata}
                      />
                    </AnimatedBlock>
                  );
                }

                if (part.type === "console_log" || part.type === "execution_section") {
                  const isFirstInSequence =
                    index === 0 ||
                    (parts[index - 1].type !== "console_log" &&
                      parts[index - 1].type !== "execution_section");
                  if (!isFirstInSequence) return null;

                  const consoleSequence: MessageBlock[] = [];
                  let nextPartIndex = parts.length;
                  for (let i = index; i < parts.length; i += 1) {
                    if (
                      parts[i].type === "console_log" ||
                      parts[i].type === "execution_section"
                    ) {
                      consoleSequence.push(parts[i]);
                    } else {
                      nextPartIndex = i;
                      break;
                    }
                  }

                  return (
                    <motion.div
                      key={`console-group-${index}`}
                      initial={{ opacity: 0, scale: 0.98 }}
                      animate={{ opacity: 1, scale: 1 }}
                    >
                      <ExecutionConsole
                        blocks={consoleSequence}
                        isActive={isActive}
                        showSandboxLabel={shouldShowSandboxLabelForConsole(nextPartIndex)}
                        title={consoleTitle}
                      />
                    </motion.div>
                  );
                }

                if (part.type === "error") {
                  return (
                    <AnimatedBlock key={`error-${index}`}>
                      <ErrorMessageBlock message={part.message} />
                    </AnimatedBlock>
                  );
                }

                const partContent = getRenderableBlockContent(part);
                if (!partContent) return null;

                return (
                  <AnimatedBlock key={`text-${index}`}>
                    <TypingTextBlock
                      content={partContent}
                      typingEnabled={typingEnabled}
                      isStreaming={Boolean(isActive && streamEnabled)}
                      messageId={messageId}
                      enableRunnableFences={enableRunnableFences}
                    />
                  </AnimatedBlock>
                );
              })}

              {isActive && streamEnabled ? (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <GhostCursor />
                </motion.div>
              ) : null}

              <AIResponseStreamingTail
                isActive={isActive}
                hasContent={hasAnswerContent}
                statusStage={statusStage}
              />
            </motion.div>
          )}
        </div>
      </div>
    );
  },
  (prevProps, nextProps) => {
    if (prevProps.parts.length !== nextProps.parts.length) {
      return false;
    }

    const partsChanged = prevProps.parts.some((prevPart, index) => {
      const nextPart = nextProps.parts[index];
      return (
        JSON.stringify(serializeComparableBlock(prevPart)) !==
        JSON.stringify(serializeComparableBlock(nextPart))
      );
    });

    if (partsChanged) {
      return false;
    }

    return (
      prevProps.isActive === nextProps.isActive &&
      prevProps.streamEnabled === nextProps.streamEnabled &&
      prevProps.typingEnabled === nextProps.typingEnabled &&
      prevProps.statusStage === nextProps.statusStage &&
      prevProps.statusCode === nextProps.statusCode &&
      JSON.stringify(prevProps.statusMeta) === JSON.stringify(nextProps.statusMeta)
    );
  },
);

function AnimatedBlock({
  children,
  ...props
}: ComponentProps<typeof motion.div>) {
  return (
    <motion.div
      initial={{ y: 8, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 120, damping: 18 }}
      {...props}
    >
      {children}
    </motion.div>
  );
}
