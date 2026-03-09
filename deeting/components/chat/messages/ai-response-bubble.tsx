"use client";

import { useEffect, useMemo, useRef, useState, memo } from "react";
import { AlertTriangle, Brain, ChevronDown, Loader2, Terminal } from "lucide-react";
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
} from "@/components/chat/visuals/status-visuals";
import { useTypewriter } from "@/hooks/chat/use-typewriter";
import { TaskLiveBlock } from "@/components/chat/messages/task-live-block";
import dynamic from "next/dynamic";

const ViewBlock = dynamic(() => import("@/components/views/view-block"), { ssr: false });

/** When a non-active message has more than this many tool calls, group them into a collapsible summary. */
const TOOL_GROUP_THRESHOLD = 2;

type RuntimeToolTraceItem = {
  index: number;
  toolName: string;
  status: string;
  durationMs: number | null;
  error: string | null;
  errorCode: string | null;
};

type SkillInstallInsight =
  | {
      state: "pending_approval";
      skillName: string | null;
      repoUrl: string | null;
      riskLevel: string | null;
      approvalToken: string | null;
    }
  | {
      state: "installed";
      skillName: string | null;
      repoUrl: string | null;
      indexedTools: number | null;
    };

type CodeModeApprovalInsight = {
  state: "pending_approval";
  language: string | null;
  approvalToken: string | null;
  expiresInMs: number | null;
};

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function extractRuntimeToolTrace(debug?: Record<string, unknown>): RuntimeToolTraceItem[] {
  if (!debug) return [];
  const runtimeToolCalls = toRecord(debug.runtime_tool_calls);
  if (!runtimeToolCalls) return [];
  const rawCalls = runtimeToolCalls.calls;
  if (!Array.isArray(rawCalls)) return [];

  const normalized: RuntimeToolTraceItem[] = [];
  for (let i = 0; i < rawCalls.length; i += 1) {
    const entry = toRecord(rawCalls[i]);
    if (!entry) continue;
    const toolName = typeof entry.tool_name === "string" ? entry.tool_name.trim() : "";
    if (!toolName) continue;
    const index = toNumber(entry.index);
    const status = typeof entry.status === "string" ? entry.status.trim() : "";
    const durationMs = toNumber(entry.duration_ms);
    const error = typeof entry.error === "string" ? entry.error.trim() : "";
    const errorCode = typeof entry.error_code === "string" ? entry.error_code.trim() : "";
    normalized.push({
      index: index ?? i,
      toolName,
      status: status || "unknown",
      durationMs,
      error: error || null,
      errorCode: errorCode || null,
    });
  }
  return normalized;
}

function extractDebugSummary(debug?: Record<string, unknown>) {
  if (!debug) {
    return {
      callCount: null as number | null,
      renderCount: null as number | null,
      sdkModule: null as string | null,
      sdkToolCount: null as number | null,
      executionId: null as string | null,
    };
  }

  const runtimeToolCalls = toRecord(debug.runtime_tool_calls);
  const renderBlocks = toRecord(debug.render_blocks);
  const sdkStub = toRecord(debug.sdk_stub);

  return {
    callCount: toNumber(runtimeToolCalls?.count),
    renderCount: toNumber(renderBlocks?.count),
    sdkModule: typeof sdkStub?.module === "string" ? sdkStub.module : null,
    sdkToolCount: toNumber(sdkStub?.tool_count),
    executionId: typeof debug.execution_id === "string" ? debug.execution_id : null,
  };
}

function formatObjectAsMarkdown(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
  } catch {
    return String(value);
  }
}

function asTrimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function extractSkillInstallInsight(toolName?: string, result?: unknown): SkillInstallInsight | null {
  if (toolName !== "sys_submit_onboarding_request") return null;
  const payload = toRecord(result);
  if (!payload) return null;
  const action = asTrimmedString(payload.action);
  if (!action) return null;

  if (action === "skill_install_pending_approval") {
    const install = toRecord(payload.install);
    return {
      state: "pending_approval",
      skillName: asTrimmedString(payload.skill_name),
      repoUrl: asTrimmedString(payload.repo_url),
      riskLevel: asTrimmedString(install?.risk_level),
      approvalToken: asTrimmedString(install?.approval_token),
    };
  }

  if (action === "skill_installed") {
    const indexRefresh = toRecord(payload.index_refresh);
    return {
      state: "installed",
      skillName: asTrimmedString(payload.skill_name),
      repoUrl: asTrimmedString(payload.repo_url),
      indexedTools: toNumber(indexRefresh?.indexed_tools),
    };
  }

  return null;
}

function extractCodeModeApprovalInsight(toolName?: string, result?: unknown): CodeModeApprovalInsight | null {
  if (toolName !== "execute_code_plan") return null;
  const payload = toRecord(result);
  if (!payload) return null;
  if (asTrimmedString(payload.action) !== "code_mode_pending_approval") return null;
  return {
    state: "pending_approval",
    language: asTrimmedString(payload.language),
    approvalToken: asTrimmedString(payload.approval_token),
    expiresInMs: toNumber(payload.expires_in_ms),
  };
}

const SkillInstallStatusCard = memo<{ insight: SkillInstallInsight }>(function SkillInstallStatusCard({
  insight,
}) {
  if (insight.state === "pending_approval") {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50/70 p-3 dark:border-amber-900 dark:bg-amber-900/20">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-xs font-semibold text-amber-800 dark:text-amber-200">
            Skill install pending approval
          </div>
          <Badge variant="outline" className="h-5 text-[10px] font-normal text-amber-700 dark:text-amber-300">
            APPROVAL
          </Badge>
        </div>
        <div className="space-y-1 text-[11px] text-amber-900/90 dark:text-amber-200/90">
          {insight.skillName ? <div>Skill: <span className="font-mono">{insight.skillName}</span></div> : null}
          {insight.repoUrl ? <div>Repo: <span className="font-mono break-all">{insight.repoUrl}</span></div> : null}
          {insight.riskLevel ? <div>Risk: <span className="font-mono">{insight.riskLevel}</span></div> : null}
          {insight.approvalToken ? (
            <div>Token: <span className="font-mono">{insight.approvalToken.slice(0, 8)}...</span></div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-emerald-300 bg-emerald-50/70 p-3 dark:border-emerald-900 dark:bg-emerald-900/20">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs font-semibold text-emerald-800 dark:text-emerald-200">
          Skill installed locally
        </div>
        <Badge variant="outline" className="h-5 text-[10px] font-normal text-emerald-700 dark:text-emerald-300">
          READY
        </Badge>
      </div>
      <div className="space-y-1 text-[11px] text-emerald-900/90 dark:text-emerald-200/90">
        {insight.skillName ? <div>Skill: <span className="font-mono">{insight.skillName}</span></div> : null}
        {insight.repoUrl ? <div>Repo: <span className="font-mono break-all">{insight.repoUrl}</span></div> : null}
        {insight.indexedTools !== null ? (
          <div>Indexed tools: <span className="font-mono">{insight.indexedTools}</span></div>
        ) : null}
      </div>
    </div>
  );
});

const CodeModeApprovalStatusCard = memo<{ insight: CodeModeApprovalInsight }>(
  function CodeModeApprovalStatusCard({ insight }) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50/70 p-3 dark:border-amber-900 dark:bg-amber-900/20">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-xs font-semibold text-amber-800 dark:text-amber-200">
            Local code execution pending approval
          </div>
          <Badge variant="outline" className="h-5 text-[10px] font-normal text-amber-700 dark:text-amber-300">
            APPROVAL
          </Badge>
        </div>
        <div className="space-y-1 text-[11px] text-amber-900/90 dark:text-amber-200/90">
          {insight.language ? <div>Language: <span className="font-mono">{insight.language}</span></div> : null}
          {insight.approvalToken ? (
            <div>Token: <span className="font-mono">{insight.approvalToken.slice(0, 8)}...</span></div>
          ) : null}
          {insight.expiresInMs !== null ? (
            <div>Expires: <span className="font-mono">{Math.round(insight.expiresInMs / 1000)}s</span></div>
          ) : null}
        </div>
      </div>
    );
  }
);

function ToolDebugPanel({ debug }: { debug?: Record<string, unknown> }) {
  const [isOpen, setIsOpen] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const rawContent = useMemo(() => formatObjectAsMarkdown(debug), [debug]);
  const runtimeTrace = useMemo(() => extractRuntimeToolTrace(debug), [debug]);
  const summary = useMemo(() => extractDebugSummary(debug), [debug]);
  if (!rawContent) return null;

  const handleCopySnapshot = async () => {
    try {
      const payload = JSON.stringify(debug ?? {}, null, 2);
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(payload);
      } else {
        throw new Error("clipboard unavailable");
      }
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 1200);
    } catch {
      setCopyState("error");
      setTimeout(() => setCopyState("idle"), 1200);
    }
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="mt-2">
      <CollapsibleTrigger asChild>
        <div className="flex items-center justify-between rounded-md border border-dashed border-amber-300/80 bg-amber-50/60 px-2 py-1 cursor-pointer hover:bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20">
          <div className="text-[11px] font-mono text-amber-700 dark:text-amber-300">
            Debug
          </div>
          <ChevronDown
            size={14}
            className={cn("text-amber-700 transition-transform duration-200 dark:text-amber-300", !isOpen && "-rotate-90")}
          />
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 rounded-md border border-amber-200 bg-amber-50/40 p-2 dark:border-amber-900 dark:bg-amber-950/20">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="flex flex-wrap gap-1">
              {summary.executionId ? (
                <Badge variant="outline" className="h-5 text-[10px] font-normal">
                  exec:{summary.executionId.slice(0, 8)}
                </Badge>
              ) : null}
              {summary.callCount !== null ? (
                <Badge variant="outline" className="h-5 text-[10px] font-normal">
                  calls:{summary.callCount}
                </Badge>
              ) : null}
              {summary.renderCount !== null ? (
                <Badge variant="outline" className="h-5 text-[10px] font-normal">
                  render:{summary.renderCount}
                </Badge>
              ) : null}
              {summary.sdkModule ? (
                <Badge variant="outline" className="h-5 text-[10px] font-normal">
                  sdk:{summary.sdkModule}
                  {summary.sdkToolCount !== null ? `(${summary.sdkToolCount})` : ""}
                </Badge>
              ) : null}
            </div>
            <button
              type="button"
              onClick={handleCopySnapshot}
              className={cn(
                "rounded border px-2 py-0.5 text-[10px] font-mono transition-colors",
                copyState === "error"
                  ? "border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/20"
                  : "border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-950/20"
              )}
            >
              {copyState === "copied"
                ? "Copied"
                : copyState === "error"
                  ? "Copy Failed"
                  : "Copy JSON"}
            </button>
          </div>

          {runtimeTrace.length > 0 ? (
            <div className="mb-2 rounded-md border border-amber-200/80 bg-amber-50/70 p-2 dark:border-amber-900 dark:bg-amber-950/10">
              <div className="mb-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                Runtime Tool Timeline
              </div>
              <ol className="space-y-1">
                {runtimeTrace.map((item) => (
                  <li
                    key={`${item.index}-${item.toolName}`}
                    className="rounded border border-amber-200/70 bg-white/70 px-2 py-1 text-[11px] dark:border-amber-900 dark:bg-amber-950/20"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 truncate font-mono text-amber-800 dark:text-amber-200">
                        #{item.index} {item.toolName}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {item.durationMs !== null ? (
                          <Badge variant="outline" className="h-5 text-[10px] font-normal">
                            {item.durationMs}ms
                          </Badge>
                        ) : null}
                        <Badge
                          variant="outline"
                          className={cn(
                            "h-5 text-[10px] font-normal shrink-0",
                            item.status === "success"
                              ? "border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300"
                              : item.status === "failed" || item.status === "error"
                                ? "border-red-300 text-red-700 dark:border-red-800 dark:text-red-300"
                                : "border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-300"
                          )}
                        >
                          {item.status}
                        </Badge>
                      </div>
                    </div>
                    {item.error ? (
                      <div className="mt-1 text-[10px] text-red-700 dark:text-red-300">
                        {item.errorCode ? `[${item.errorCode}] ` : ""}
                        {item.error}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          <details className="group">
            <summary className="cursor-pointer select-none text-[11px] font-mono text-amber-700 underline decoration-dotted underline-offset-2 dark:text-amber-300">
              Raw JSON
            </summary>
            <div className="mt-2 overflow-x-auto rounded-md border border-amber-200/80 bg-amber-50/70 p-2 dark:border-amber-900 dark:bg-amber-950/10">
              <MarkdownViewer content={rawContent} className="chat-markdown chat-markdown-assistant text-xs" />
            </div>
          </details>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

interface AIResponseBubbleProps {
  parts: MessageBlock[];
  isActive?: boolean;
  streamEnabled?: boolean;
  typingEnabled?: boolean;
  statusStage?: string | null;
  statusCode?: string | null;
  statusMeta?: Record<string, unknown> | null;
}

/**
 * AI 响应气泡组件
 * 
 * 用于展示 AI 助手的响应消息，支持：
 * - 思维链（CoT）展示
 * - MCP 工具调用展示
 * - Markdown 文本渲染
 * - 流式和批量模式
 * - 状态进度展示
 * 
 * 性能优化：
 * - 使用 React.memo 避免不必要的重渲染
 * - 使用 useMemo 缓存计算结果
 * - 自定义比较函数优化渲染判断
 * 
 * @component
 */
export const AIResponseBubble = memo<AIResponseBubbleProps>(
  function AIResponseBubble({
    parts,
    isActive = false,
    streamEnabled = false,
    typingEnabled = false,
    statusStage = null,
    statusCode = null,
    statusMeta = null,
  }) {
    const t = useI18n("chat");
    
    // 缓存步骤配置，避免每次渲染重新创建
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
    
    // 缓存内容检查结果
    const hasContent = useMemo(() => parts.length > 0, [parts.length]);
    
    const statusDetail = useMemo(
      () => resolveStatusDetail(t, statusCode, statusMeta),
      [t, statusCode, statusMeta]
    );

    // 将 tool_result 与对应的 tool_call 配对（通过 callId）
    const { resultMap, pairedResultIndices } = useMemo(() => {
      const map = new Map<string, MessageBlock>();
      const paired = new Set<number>();
      parts.forEach((part, index) => {
        if (part.type === 'tool_result' && part.callId) {
          map.set(part.callId, part);
          if (parts.some(p => p.type === 'tool_call' && p.callId === part.callId)) {
            paired.add(index);
          }
        }
      });
      return { resultMap: map, pairedResultIndices: paired };
    }, [parts]);

    // 当非活跃消息的工具调用数量超过阈值时，将它们分组折叠展示
    const { shouldGroupTools, toolCallEntries, firstToolCallIndex } = useMemo(() => {
      const entries: Array<{ part: MessageBlock; index: number }> = [];
      parts.forEach((part, idx) => {
        if (part.type === 'tool_call') {
          entries.push({ part, index: idx });
        }
      });
      return {
        shouldGroupTools: entries.length > TOOL_GROUP_THRESHOLD && !isActive,
        toolCallEntries: entries,
        firstToolCallIndex: entries.length > 0 ? entries[0].index : -1,
      };
    }, [parts, isActive]);

    return (
      <div
        className={cn(
          "w-fit max-w-full rounded-2xl rounded-tl-none text-[15px] leading-relaxed",
          "bg-white/95 dark:bg-zinc-900/95 border border-slate-100 dark:border-zinc-800 text-foreground",
          "shadow-sm backdrop-blur-sm overflow-hidden"
        )}
        data-slot="glass-card"
        >
          <div className="px-5 py-3.5 min-w-0 overflow-hidden">
            {isActive && (
              <div className="mb-3">
                <StatusStream
                  steps={steps}
                  activeIndex={activeStep}
                  compact={hasContent}
                  label={streamEnabled ? t("status.flow.stream") : t("status.flow.batch")}
                  detail={statusDetail}
                />
              </div>
            )}

            <AnimatePresence mode="sync">
              {!hasContent && (
                <motion.div
                  key="placeholder"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, transition: { duration: 0.15 } }}
                >
                  <HolographicPulse
                    label={streamEnabled ? t("status.placeholder.stream") : t("status.placeholder.batch")}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {hasContent && (
              <div className="space-y-3">
                {parts.map((part, index) => {
                  // --- A. 思维链 (CoT) ---
                  if (part.type === 'thought') {
                    return (
                      <motion.div
                        key={`thought-${index}`}
                        initial={{ y: 8, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ type: "spring", stiffness: 120, damping: 18 }}
                      >
                        <ThoughtBlock content={part.content} cost={part.cost} />
                      </motion.div>
                    );
                  }

                  if (part.type === 'assistant_transition') {
                    return (
                      <motion.div
                        key={`assistant-transition-${index}`}
                        initial={{ y: 8, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ type: "spring", stiffness: 120, damping: 18 }}
                      >
                        <AssistantTransitionCard
                          action={part.action}
                          assistantName={part.assistantName}
                          reason={part.reason}
                        />
                      </motion.div>
                    );
                  }

                  // --- B. MCP 工具调用（含折叠结果） ---
                  if (part.type === 'tool_call') {
                    // 分组模式：在第一个 tool_call 位置渲染分组组件，跳过后续的
                    if (shouldGroupTools) {
                      if (index === firstToolCallIndex) {
                        return (
                          <motion.div
                            key="tool-group"
                            initial={{ y: 8, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            transition={{ type: "spring", stiffness: 120, damping: 18 }}
                          >
                            <ToolCallGroup
                              toolCalls={toolCallEntries}
                              resultMap={resultMap}
                            />
                          </motion.div>
                        );
                      }
                      return null;
                    }
                    return (
                      <motion.div
                        key={`tool-${index}`}
                        initial={{ y: 8, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ type: "spring", stiffness: 120, damping: 18 }}
                      >
                        <ToolCallBlock
                          name={part.toolName}
                          args={part.toolArgs}
                          status={part.status}
                          resultBlock={part.callId ? resultMap.get(part.callId) : undefined}
                        />
                      </motion.div>
                    );
                  }

                  // --- C. MCP 工具结果（已配对的跳过，由 ToolCallBlock 折叠展示） ---
                  if (part.type === 'tool_result') {
                    if (pairedResultIndices.has(index)) return null;
                    return (
                      <motion.div
                        key={`tool-result-${index}`}
                        initial={{ y: 8, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ type: "spring", stiffness: 120, damping: 18 }}
                      >
                        <ToolResultBlock
                          name={part.toolName}
                          callId={part.callId}
                          status={part.status}
                          result={part.result}
                          debug={part.debug}
                        />
                      </motion.div>
                    );
                  }

                  // --- D. UI 视图块（插件渲染） ---
                  if (part.type === 'ui') {
                    return (
                      <motion.div
                        key={`ui-${index}`}
                        initial={{ y: 8, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ type: "spring", stiffness: 120, damping: 18 }}
                      >
                        <ViewBlock
                          viewType={part.viewType}
                          payload={part.payload}
                          title={part.title}
                          metadata={part.metadata}
                        />
                      </motion.div>
                    );
                  }

                  // --- E. 实时控制台日志 (Streaming Stdout) ---
                  if (part.type === 'console_log' || part.type === 'execution_section') {
                    // 我们采用聚合逻辑：如果是连续的日志/章节，只在第一处渲染整个控制台，后续的跳过
                    const isFirstInSequence = index === 0 || 
                      (parts[index-1].type !== 'console_log' && parts[index-1].type !== 'execution_section');
                    
                    if (!isFirstInSequence) return null;

                    // 收集后续所有连续的控制台相关块
                    const consoleSequence: MessageBlock[] = [];
                    for (let i = index; i < parts.length; i++) {
                      if (parts[i].type === 'console_log' || parts[i].type === 'execution_section') {
                        consoleSequence.push(parts[i]);
                      } else {
                        break;
                      }
                    }

                    return (
                      <motion.div
                        key={`console-group-${index}`}
                        initial={{ opacity: 0, scale: 0.98 }}
                        animate={{ opacity: 1, scale: 1 }}
                      >
                        <ExecutionConsole blocks={consoleSequence} isActive={isActive} />
                      </motion.div>
                    );
                  }

                  if (part.type === 'error') {
                    return (
                      <motion.div
                        key={`error-${index}`}
                        initial={{ y: 8, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ type: "spring", stiffness: 120, damping: 18 }}
                      >
                        <ErrorMessageBlock message={part.message} />
                      </motion.div>
                    );
                  }

                  // --- D. 普通文本 ---
                  if (!part.content) return null;

                  return (
                    <motion.div
                      key={`text-${index}`}
                      initial={{ y: 8, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{ type: "spring", stiffness: 120, damping: 18 }}
                    >
                      <TypingTextBlock
                        content={part.content}
                        typingEnabled={typingEnabled}
                      />
                    </motion.div>
                  );
                })}

                {isActive && streamEnabled && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                  >
                    <GhostCursor />
                  </motion.div>
                )}
              </div>
            )}
          </div>
        </div>
    );
  },
  // 自定义比较函数，优化重渲染判断
  (prevProps, nextProps) => {
    // 如果 parts 数组长度不同，需要重渲染
    if (prevProps.parts.length !== nextProps.parts.length) {
      return false;
    }
    
    // 如果 parts 内容不同，需要重渲染
    // 这里进行浅比较，检查每个 part 的关键属性
    const partsChanged = prevProps.parts.some((prevPart, index) => {
      const nextPart = nextProps.parts[index];
      return (
        prevPart.type !== nextPart.type ||
        prevPart.content !== nextPart.content ||
        prevPart.toolName !== nextPart.toolName ||
        prevPart.toolArgs !== nextPart.toolArgs ||
        prevPart.callId !== nextPart.callId ||
        prevPart.result !== nextPart.result ||
        JSON.stringify((prevPart as any).debug) !== JSON.stringify((nextPart as any).debug) ||
        prevPart.message !== nextPart.message ||
        prevPart.status !== nextPart.status ||
        prevPart.cost !== nextPart.cost ||
        (prevPart as any).viewType !== (nextPart as any).viewType ||
        (prevPart as any).payload !== (nextPart as any).payload
      );
    });
    
    if (partsChanged) {
      return false;
    }
    
    // 检查其他关键 props
    return (
      prevProps.isActive === nextProps.isActive &&
      prevProps.streamEnabled === nextProps.streamEnabled &&
      prevProps.typingEnabled === nextProps.typingEnabled &&
      prevProps.statusStage === nextProps.statusStage &&
      prevProps.statusCode === nextProps.statusCode &&
      // statusMeta 进行浅比较
      JSON.stringify(prevProps.statusMeta) === JSON.stringify(nextProps.statusMeta)
    );
  }
);

const TypingTextBlock = memo<{ content: string; typingEnabled: boolean }>(
  function TypingTextBlock({ content, typingEnabled }) {
    const { displayed } = useTypewriter(content ?? "", typingEnabled);

    return (
      <MarkdownViewer
        content={displayed}
        className="chat-markdown chat-markdown-assistant"
      />
    );
  }
);

// === 组件：思维链折叠块 (Terminal Style) ===
// 使用 memo 优化子组件
const ThoughtBlock = memo<{ content?: string; cost?: string }>(
  function ThoughtBlock({ content, cost }) {
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
);

const AssistantTransitionCard = memo<{
  action?: "activated" | "deactivated" | "updated";
  assistantName?: string;
  reason?: string;
}>(
  function AssistantTransitionCard({ action, assistantName, reason }) {
    const title =
      action === "activated"
        ? `已切换到助手${assistantName ? `：${assistantName}` : ""}`
        : action === "deactivated"
          ? `已退出助手${assistantName ? `：${assistantName}` : ""}`
          : `助手上下文已更新${assistantName ? `：${assistantName}` : ""}`;
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
  }
);

// === 组件：MCP 工具块（可折叠展示结果） ===
const ToolCallBlock = memo<{
  name?: string;
  args?: string;
  status?: string;
  resultBlock?: MessageBlock;
}>(
  function ToolCallBlock({ name, args, status, resultBlock }) {
    const [isOpen, setIsOpen] = useState(false);
    const isRunning = status === 'running';
    const isError = status === 'error';
    const hasResult = !!resultBlock;

    // TaskLiveBlock special case
    const taskLiveId = useMemo(() => {
      if (!resultBlock || resultBlock.status === 'error') return null;
      if (
        resultBlock.toolName?.startsWith("skill__system.") &&
        typeof resultBlock.result === "object" &&
        resultBlock.result !== null &&
        "task_id" in resultBlock.result
      ) {
        return (resultBlock.result as { task_id: string }).task_id || null;
      }
      return null;
    }, [resultBlock]);

    const skillInstallInsight = useMemo(
      () => extractSkillInstallInsight(resultBlock?.toolName || name, resultBlock?.result),
      [resultBlock?.toolName, name, resultBlock?.result]
    );

    const resultContent = useMemo(() => {
      return formatObjectAsMarkdown(resultBlock?.result);
    }, [resultBlock?.result]);

    const isResultError = resultBlock?.status === "error";

    const card = (
      <div className={cn(
        "flex items-center gap-3 p-3 rounded-lg border text-sm w-full max-w-md transition-all",
        isRunning
          ? "border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-900/20"
          : "border-border bg-card",
        isError && "border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-900/20",
        hasResult && !isRunning && "cursor-pointer select-none hover:bg-muted/50"
      )}>
        {/* Icon Status */}
        <div className={cn(
          "w-8 h-8 rounded flex items-center justify-center shrink-0",
          isRunning
            ? "bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300"
            : "bg-muted text-muted-foreground",
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

        {/* Expand/Collapse indicator */}
        {hasResult && !isRunning && (
          <div className="text-muted-foreground">
            <ChevronDown size={16} className={cn("transition-transform duration-200", !isOpen && "-rotate-90")} />
          </div>
        )}
      </div>
    );

    if (!hasResult) return card;

    return (
      <Collapsible open={isOpen} onOpenChange={setIsOpen} className="w-full">
        <CollapsibleTrigger asChild>
          {card}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2">
            {taskLiveId ? (
              <TaskLiveBlock taskId={taskLiveId} />
            ) : skillInstallInsight ? (
              <SkillInstallStatusCard insight={skillInstallInsight} />
            ) : (
              <div className={cn(
                "rounded-lg border p-3 text-sm overflow-hidden",
                isResultError
                  ? "border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-900/20"
                  : "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-900/20"
              )}>
                <div className="mb-2 flex items-center justify-between">
                  <div className="font-mono text-xs font-semibold truncate">
                    {resultBlock.toolName || resultBlock.callId || "result"}
                  </div>
                  <Badge variant="outline" className="h-5 text-[10px] font-normal shrink-0">
                    {isResultError ? "ERROR" : "OUTPUT"}
                  </Badge>
                </div>
                {resultContent ? (
                  <div className="overflow-x-auto">
                    <MarkdownViewer content={resultContent} className="chat-markdown chat-markdown-assistant text-sm" />
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground">No output</div>
                )}
                <ToolDebugPanel debug={resultBlock?.debug} />
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  }
);

// === 组件：多工具调用分组折叠（历史消息优化） ===
const ToolCallGroup = memo<{
  toolCalls: Array<{ part: MessageBlock; index: number }>;
  resultMap: Map<string, MessageBlock>;
}>(
  function ToolCallGroup({ toolCalls, resultMap }) {
    const [isOpen, setIsOpen] = useState(false);
    const t = useI18n("chat");

    const uniqueNames = useMemo(() => {
      const names = new Set<string>();
      toolCalls.forEach(({ part }) => {
        if (part.toolName) names.add(part.toolName);
      });
      return Array.from(names);
    }, [toolCalls]);

    return (
      <Collapsible open={isOpen} onOpenChange={setIsOpen} className="w-full">
        <CollapsibleTrigger asChild>
          <div className={cn(
            "flex items-center gap-3 p-3 rounded-lg border text-sm w-full max-w-md transition-all cursor-pointer select-none",
            "border-border bg-card hover:bg-muted/50"
          )}>
            <div className="w-8 h-8 rounded flex items-center justify-center shrink-0 bg-muted text-muted-foreground">
              <Terminal size={16} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold font-mono text-sm">
                  {t("toolGroup.summary", { count: toolCalls.length })}
                </span>
                <Badge variant="outline" className="text-[10px] h-5 font-normal text-muted-foreground">
                  MCP
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground truncate font-mono mt-0.5 opacity-80">
                {uniqueNames.join(", ")}
              </div>
            </div>
            <ChevronDown size={16} className={cn(
              "text-muted-foreground transition-transform duration-200",
              !isOpen && "-rotate-90"
            )} />
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 space-y-2 pl-3 border-l-2 border-border/50">
            {toolCalls.map(({ part, index }) => (
              <ToolCallBlock
                key={`tool-${index}`}
                name={part.toolName}
                args={part.toolArgs}
                status={part.status}
                resultBlock={part.callId ? resultMap.get(part.callId) : undefined}
              />
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  }
);

const ToolResultBlock = memo<{
  name?: string;
  callId?: string;
  status?: "success" | "error";
  result?: unknown;
  debug?: Record<string, unknown>;
}>(function ToolResultBlock({ name, callId, status, result, debug }) {
  const [isOpen, setIsOpen] = useState(false);
  const title = name || callId || "tool_result";
  const isError = status === "error";
  const skillInstallInsight = useMemo(
    () => extractSkillInstallInsight(name, result),
    [name, result]
  );
  const codeModeApprovalInsight = useMemo(
    () => extractCodeModeApprovalInsight(name, result),
    [name, result]
  );

  // Special Handling for System Skills (Live Tasks)
  if (
    !isError &&
    name?.startsWith("skill__system.") &&
    typeof result === "object" &&
    result !== null &&
    "task_id" in result
  ) {
    const taskId = (result as { task_id: string }).task_id;
    if (taskId) {
      return <TaskLiveBlock taskId={taskId} />;
    }
  }

  const content = useMemo(() => {
    return formatObjectAsMarkdown(result);
  }, [result]);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="w-full">
      <CollapsibleTrigger asChild>
        <div className={cn(
          "flex items-center gap-3 p-3 rounded-lg border text-sm w-full max-w-md transition-all cursor-pointer select-none hover:bg-muted/50",
          isError
            ? "border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-900/20"
            : "border-border bg-card"
        )}>
          <div className={cn(
            "w-8 h-8 rounded flex items-center justify-center shrink-0",
            isError
              ? "bg-red-100 text-red-500 dark:bg-red-900 dark:text-red-300"
              : "bg-muted text-muted-foreground"
          )}>
            <Terminal size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <span className="font-semibold font-mono truncate">{title}</span>
              <Badge variant="outline" className="text-[10px] h-5 font-normal text-muted-foreground shrink-0">
                {isError ? "ERROR" : "OUTPUT"}
              </Badge>
            </div>
          </div>
          <div className="text-muted-foreground">
            <ChevronDown size={16} className={cn("transition-transform duration-200", !isOpen && "-rotate-90")} />
          </div>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2">
          <div className={cn(
            "rounded-lg border p-3 text-sm overflow-hidden",
            isError
              ? "border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-900/20"
              : "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-900/20"
          )}>
            {skillInstallInsight ? (
              <SkillInstallStatusCard insight={skillInstallInsight} />
            ) : codeModeApprovalInsight ? (
              <CodeModeApprovalStatusCard insight={codeModeApprovalInsight} />
            ) : content ? (
              <div className="overflow-x-auto">
                <MarkdownViewer content={content} className="chat-markdown chat-markdown-assistant text-sm" />
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">No output</div>
            )}
            <ToolDebugPanel debug={debug} />
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
});

const ErrorMessageBlock = memo<{ message?: string }>(function ErrorMessageBlock({ message }) {
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
});

// === 组件：实时执行控制台 (Terminal Style) ===
const ExecutionConsole = memo<{ blocks: MessageBlock[]; isActive: boolean }>(
  function ExecutionConsole({ blocks, isActive }) {
    const [isExpanded, setIsOpen] = useState(true);
    const scrollRef = useRef<HTMLDivElement>(null);

    // 自动滚动到底部
    useEffect(() => {
      if (isActive && scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }, [blocks.length, isActive]);

    return (
      <div className="w-full max-w-2xl my-2 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800 shadow-sm bg-zinc-50 dark:bg-zinc-950 text-left">
        {/* Header */}
        <div 
          className="flex items-center justify-between px-3 py-2 bg-zinc-100 dark:bg-zinc-900 cursor-pointer border-b border-zinc-200 dark:border-zinc-800"
          onClick={() => setIsOpen(!isExpanded)}
        >
          <div className="flex items-center gap-2">
            <Terminal size={14} className="text-zinc-500" />
            <span className="text-xs font-mono font-bold text-zinc-600 dark:text-zinc-400">
              SANDBOX EXECUTION
            </span>
            {isActive && (
              <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            )}
          </div>
          <ChevronDown 
            size={14} 
            className={cn("text-zinc-400 transition-transform duration-200", !isExpanded && "-rotate-90")} 
          />
        </div>

        {/* Console Body */}
        <Collapsible open={isExpanded}>
          <CollapsibleContent>
            <div 
              ref={scrollRef}
              className="p-3 max-h-[300px] overflow-y-auto font-mono text-[11px] leading-relaxed"
            >
              {blocks.map((block, i) => {
                if (block.type === 'execution_section') {
                  const b = block as ExecutionSectionBlock;
                  return (
                    <div key={i} className="mt-3 mb-1 text-zinc-900 dark:text-zinc-100 font-bold border-b border-zinc-200 dark:border-zinc-800 pb-0.5">
                      {`> ${b.title}`}
                    </div>
                  );
                }
                if (block.type === 'console_log') {
                  const b = block as ConsoleLogBlock;
                  const isError = b.stream === 'stderr';
                  return (
                    <div key={i} className={cn(
                      "whitespace-pre-wrap break-all",
                      isError ? "text-red-500" : "text-zinc-600 dark:text-zinc-400"
                    )}>
                      <span className="opacity-30 mr-2 select-none">|</span>
                      {b.content}
                    </div>
                  );
                }
                return null;
              })}
              
              {isActive && (
                <div className="flex items-center gap-1 mt-1 opacity-50 italic">
                  <Loader2 size={10} className="animate-spin" />
                  <span>Executing...</span>
                </div>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    );
  }
);
