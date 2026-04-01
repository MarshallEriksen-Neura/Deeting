"use client";

import { useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
import { AlertTriangle, Brain, Check, ChevronDown, Loader2, Terminal, Zap } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { resolveStatusDetail } from "@/lib/chat/status-detail";
import { isToolApprovalResultBlock } from "@/lib/chat/assistant-activity";
import { useBridgeApprovalStore } from "@/lib/chat/bridge-approval-store";
import { useI18n } from "@/hooks/use-i18n";
import type {
  MessageBlock,
  UIBlock as MessageUIBlock,
  ToolCallBlock as MessageToolCallBlock,
  ToolResultBlock as MessageToolResultBlock,
} from "@/lib/chat/message-protocol";
import { MarkdownViewer } from "@/components/chat/markdown-viewer";
import { motion } from "framer-motion";
import {
  TerminalStream,
  type TerminalStreamHistoryItem,
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

type ShellExecutionInsight = {
  command: string | null;
  resolvedProgram: string | null;
  shellFamily: string | null;
  exitCode: number | null;
  durationMs: number | null;
  workingDir: string | null;
  encodingStdout: string | null;
  encodingStderr: string | null;
  stdout: string | null;
  stderr: string | null;
  approvalLevel: string | null;
  diagnostics: string[];
  warnings: string[];
};

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isToolCallMessageBlock(
  block: MessageBlock | null | undefined
): block is MessageToolCallBlock {
  return !!block && block.type === "tool_call";
}

function isToolResultMessageBlock(
  block: MessageBlock | null | undefined
): block is MessageToolResultBlock {
  return !!block && block.type === "tool_result";
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

const INTERNAL_TOOL_NAMES = new Set([
  "search_sdk",
  "execute_code_plan",
  "consult_expert_network",
  "attach_capability",
  "detach_capability",
  "sys_submit_onboarding_request",
  "shell_execute",
]);

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  search_sdk: "SDK Search",
  execute_code_plan: "Code Execution",
  consult_expert_network: "Expert Consult",
  attach_capability: "Activate Skill",
  detach_capability: "Deactivate Skill",
  sys_submit_onboarding_request: "Onboarding",
  shell_execute: "Shell Execute",
  "shell.exec": "Shell Execute",
};

function humanizeToolName(name?: string): string {
  if (!name) return "tool";
  return TOOL_DISPLAY_NAMES[name] || name;
}

function isInternalTool(name?: string): boolean {
  return !!name && INTERNAL_TOOL_NAMES.has(name);
}

function asTrimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
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

function extractShellExecutionInsight(toolName?: string, result?: unknown): ShellExecutionInsight | null {
  const payload = toRecord(result);
  if (!payload) return null;

  const shellTool = toolName === "shell_execute" || toolName === "shell.exec";
  const hasExecutionFields =
    payload.resolved_program !== undefined ||
    payload.shell_family !== undefined ||
    payload.encoding_stdout !== undefined ||
    payload.encoding_stderr !== undefined ||
    payload.exit_code !== undefined ||
    payload.duration_ms !== undefined;
  const hasOutputFields =
    typeof payload.stdout === "string" ||
    typeof payload.stderr === "string" ||
    typeof payload.command === "string";

  if (!hasExecutionFields && !(shellTool && hasOutputFields)) {
    return null;
  }

  return {
    command: asTrimmedString(payload.command),
    resolvedProgram: asTrimmedString(payload.resolved_program),
    shellFamily: asTrimmedString(payload.shell_family),
    exitCode: toNumber(payload.exit_code),
    durationMs: toNumber(payload.duration_ms),
    workingDir: asTrimmedString(payload.working_dir),
    encodingStdout: asTrimmedString(payload.encoding_stdout),
    encodingStderr: asTrimmedString(payload.encoding_stderr),
    stdout: typeof payload.stdout === "string" ? payload.stdout : null,
    stderr: typeof payload.stderr === "string" ? payload.stderr : null,
    approvalLevel: asTrimmedString(payload.approval_level),
    diagnostics: toStringArray(payload.diagnostics),
    warnings: toStringArray(payload.warnings),
  };
}

function summarizeShellExecutionInsight(insight: ShellExecutionInsight): string | null {
  const parts: string[] = [];
  if (insight.resolvedProgram) parts.push(insight.resolvedProgram);
  if (insight.shellFamily) parts.push(insight.shellFamily);
  if (insight.exitCode !== null) parts.push(`exit ${insight.exitCode}`);

  const encodings = [insight.encodingStdout, insight.encodingStderr].filter(
    (value, index, values): value is string => !!value && values.indexOf(value) === index
  );
  if (encodings.length > 0) {
    parts.push(`enc ${encodings.join("/")}`);
  }

  if (insight.durationMs !== null) {
    parts.push(`${insight.durationMs}ms`);
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}

function summarizeToolCalls(parts: MessageBlock[]) {
  const toolNames: string[] = [];
  for (const part of parts) {
    if (part.type !== "tool_call") continue;
    if (typeof part.toolName === "string" && part.toolName.trim().length > 0) {
      toolNames.push(part.toolName.trim());
    } else {
      toolNames.push("tool");
    }
  }
  if (toolNames.length === 0) return null;
  const counter = new Map<string, number>();
  toolNames.forEach((name) => {
    counter.set(name, (counter.get(name) ?? 0) + 1);
  });
  const sorted = Array.from(counter.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([name, count]) => {
      const display = humanizeToolName(name);
      return count > 1 ? `${display}×${count}` : display;
    });
  const allInternal = toolNames.every((n) => isInternalTool(n));
  return {
    totalCalls: toolNames.length,
    highlights: sorted.join(" · "),
    allInternal,
  };
}

type ToolVisualState = "running" | "success" | "error" | "pending";

function toInlinePreview(value: string, maxLength = 96): string | null {
  const normalized = value
    .replace(/```json/gi, " ")
    .replace(/```/g, " ")
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function summarizeUnknownValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return toInlinePreview(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return toInlinePreview(
      value
        .slice(0, 3)
        .map((item) => summarizeUnknownValue(item) ?? String(item))
        .join(" · ")
    );
  }
  const record = toRecord(value);
  if (record) {
    for (const key of ["summary", "message", "title", "status", "text", "content", "error"]) {
      const nextValue = record[key];
      if (typeof nextValue === "string" && nextValue.trim()) {
        return toInlinePreview(nextValue);
      }
    }
    try {
      return toInlinePreview(JSON.stringify(record));
    } catch {
      return null;
    }
  }
  try {
    return toInlinePreview(JSON.stringify(value));
  } catch {
    return toInlinePreview(String(value));
  }
}

function resolveToolVisualState(status?: string, resultBlock?: MessageToolResultBlock): ToolVisualState {
  const normalized = (status ?? "").trim().toLowerCase();
  if (normalized === "error" || normalized === "failed") return "error";
  if (normalized === "requires_approval") return "pending";
  if (normalized === "running" || normalized === "pending") return "running";
  if (normalized === "success" || normalized === "succeeded") {
    if (resultBlock && isToolApprovalResultBlock(resultBlock)) return "pending";
    return "success";
  }
  if (resultBlock?.status === "error") return "error";
  if (resultBlock && isToolApprovalResultBlock(resultBlock)) return "pending";
  if (resultBlock) return "success";
  return "pending";
}

function resolveToolPreview(
  args?: string,
  resultBlock?: MessageToolResultBlock,
  uiBlocks: MessageUIBlock[] = []
): string | null {
  for (const uiBlock of uiBlocks) {
    if (typeof uiBlock.title === "string" && uiBlock.title.trim()) {
      return toInlinePreview(uiBlock.title);
    }
  }
  const shellExecutionInsight = extractShellExecutionInsight(resultBlock?.toolName, resultBlock?.result);
  const shellExecutionPreview = shellExecutionInsight
    ? summarizeShellExecutionInsight(shellExecutionInsight)
    : null;
  if (shellExecutionPreview) return shellExecutionPreview;
  const resultPreview = summarizeUnknownValue(resultBlock?.result);
  if (resultPreview) return resultPreview;
  if (typeof args === "string" && args.trim()) {
    return toInlinePreview(args);
  }
  return null;
}

function ToolStateGlyph({ state }: { state: ToolVisualState }) {
  return (
    <span
      className={cn(
        "flex h-5 w-5 items-center justify-center rounded-full border",
        state === "running" &&
          "border-blue-200 bg-blue-100/90 text-blue-600 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300",
        state === "success" &&
          "border-emerald-200 bg-emerald-100/90 text-emerald-600 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
        state === "error" &&
          "border-red-200 bg-red-100/90 text-red-600 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300",
        state === "pending" &&
          "border-slate-200 bg-white/90 text-slate-400 dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-500"
      )}
    >
      {state === "running" ? (
        <Zap size={11} className="animate-pulse" />
      ) : state === "success" ? (
        <Check size={11} />
      ) : state === "error" ? (
        <AlertTriangle size={11} />
      ) : (
        <Terminal size={11} />
      )}
    </span>
  );
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

const ShellExecutionResultCard = memo<{ insight: ShellExecutionInsight }>(function ShellExecutionResultCard({
  insight,
}) {
  const encodingSummary = [insight.encodingStdout, insight.encodingStderr]
    .filter((value, index, values): value is string => !!value && values.indexOf(value) === index)
    .join(" / ");

  return (
    <div className="rounded-lg border border-slate-300 bg-slate-50/80 p-3 dark:border-zinc-800 dark:bg-zinc-950/40">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {insight.resolvedProgram ? (
          <Badge variant="outline" className="h-5 text-[10px] font-normal">
            program:{insight.resolvedProgram}
          </Badge>
        ) : null}
        {insight.shellFamily ? (
          <Badge variant="outline" className="h-5 text-[10px] font-normal">
            shell:{insight.shellFamily}
          </Badge>
        ) : null}
        {insight.exitCode !== null ? (
          <Badge variant="outline" className="h-5 text-[10px] font-normal">
            exit:{insight.exitCode}
          </Badge>
        ) : null}
        {insight.durationMs !== null ? (
          <Badge variant="outline" className="h-5 text-[10px] font-normal">
            {insight.durationMs}ms
          </Badge>
        ) : null}
      </div>

      <div className="space-y-1 text-[11px] text-slate-800/90 dark:text-zinc-200/90">
        {insight.command ? (
          <div>
            Command: <span className="font-mono break-all">{insight.command}</span>
          </div>
        ) : null}
        {insight.workingDir ? (
          <div>
            Working dir: <span className="font-mono break-all">{insight.workingDir}</span>
          </div>
        ) : null}
        {encodingSummary ? (
          <div>
            Encoding: <span className="font-mono">{encodingSummary}</span>
          </div>
        ) : null}
        {insight.approvalLevel ? (
          <div>
            Approval: <span className="font-mono">{insight.approvalLevel}</span>
          </div>
        ) : null}
      </div>

      {insight.warnings.length > 0 ? (
        <div className="mt-3 rounded-md border border-amber-300/80 bg-amber-50/70 p-2 dark:border-amber-900 dark:bg-amber-950/20">
          <div className="mb-1 text-[11px] font-semibold text-amber-800 dark:text-amber-200">Warnings</div>
          <div className="space-y-1 text-[11px] text-amber-900/90 dark:text-amber-200/90">
            {insight.warnings.map((warning, index) => (
              <div key={`warning-${index}`}>{warning}</div>
            ))}
          </div>
        </div>
      ) : null}

      {insight.diagnostics.length > 0 ? (
        <div className="mt-3 rounded-md border border-sky-300/80 bg-sky-50/70 p-2 dark:border-sky-900 dark:bg-sky-950/20">
          <div className="mb-1 text-[11px] font-semibold text-sky-800 dark:text-sky-200">Diagnostics</div>
          <div className="space-y-1 text-[11px] text-sky-900/90 dark:text-sky-200/90">
            {insight.diagnostics.map((diagnostic, index) => (
              <div key={`diagnostic-${index}`}>{diagnostic}</div>
            ))}
          </div>
        </div>
      ) : null}

      {insight.stdout ? (
        <details className="mt-3 group" open>
          <summary className="cursor-pointer select-none text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
            stdout
          </summary>
          <pre className="mt-2 overflow-x-auto rounded-md border border-emerald-200 bg-emerald-50/70 p-2 text-[11px] whitespace-pre-wrap break-all text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-100">
            {insight.stdout}
          </pre>
        </details>
      ) : null}

      {insight.stderr ? (
        <details className="mt-3 group" open={insight.exitCode !== 0}>
          <summary className="cursor-pointer select-none text-[11px] font-semibold text-red-700 dark:text-red-300">
            stderr
          </summary>
          <pre className="mt-2 overflow-x-auto rounded-md border border-red-200 bg-red-50/70 p-2 text-[11px] whitespace-pre-wrap break-all text-red-950 dark:border-red-900 dark:bg-red-950/20 dark:text-red-100">
            {insight.stderr}
          </pre>
        </details>
      ) : null}
    </div>
  );
});


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
    const [stableActiveStep, setStableActiveStep] = useState(0);
    const [detailRepeat, setDetailRepeat] = useState(1);
    const [stableDetail, setStableDetail] = useState<string | null>(null);
    const [stageHistory, setStageHistory] = useState<TerminalStreamHistoryItem[]>([]);
    const lastDetailRef = useRef<string | null>(null);
    
    // 缓存内容检查结果
    const hasContent = useMemo(() => parts.length > 0, [parts.length]);
    
    const statusDetail = useMemo(
      () => resolveStatusDetail(t, statusCode, statusMeta),
      [t, statusCode, statusMeta]
    );
    const repeatCountFromMeta = useMemo(() => {
      const raw = statusMeta?.repeat_count;
      if (typeof raw !== "number" || !Number.isFinite(raw)) return 1;
      return Math.max(1, Math.floor(raw));
    }, [statusMeta]);

    useEffect(() => {
      if (!isActive) {
        if (!hasContent) {
          setStableActiveStep(0);
        }
        return;
      }
      setStableActiveStep((prev) => Math.max(prev, activeStep));
    }, [activeStep, hasContent, isActive]);

    useEffect(() => {
      if (!isActive) {
        if (!hasContent) {
          setStableDetail(null);
          setDetailRepeat(1);
          lastDetailRef.current = null;
        }
        return;
      }
      const nextDetail = typeof statusDetail === "string" ? statusDetail.trim() : "";
      if (!nextDetail) return;
      if (lastDetailRef.current === nextDetail) {
        setDetailRepeat((current) => current + 1);
        return;
      }
      lastDetailRef.current = nextDetail;
      setStableDetail(nextDetail);
      setDetailRepeat(1);
    }, [hasContent, isActive, statusDetail]);

    useEffect(() => {
      if (!isActive) {
        if (!hasContent) {
          setStageHistory((prev) => (prev.length === 0 ? prev : []));
        }
        return;
      }
      const fallbackStage = steps[Math.min(stableActiveStep, steps.length - 1)]?.key ?? null;
      const stageKey = statusStage && steps.some((step) => step.key === statusStage) ? statusStage : fallbackStage;
      if (!stageKey) return;
      const stageLabel = steps.find((step) => step.key === stageKey)?.label ?? stageKey;
      setStageHistory((prev) => {
        if (prev[prev.length - 1]?.key === stageKey) {
          return prev;
        }
        const withoutDuplicate = prev.filter((entry) => entry.key !== stageKey);
        return [...withoutDuplicate, { key: stageKey, label: stageLabel }].slice(-6);
      });
    }, [hasContent, isActive, statusStage, stableActiveStep, steps]);

    // 将 tool_result 与对应的 tool_call 配对（通过 callId）
    const { resultMap, pairedResultIndices } = useMemo(() => {
      const map = new Map<string, MessageToolResultBlock>();
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

    const { uiBlocksByCallId, pairedUiIndices, hasCallLinkedUi } = useMemo(() => {
      const toolCallIds = new Set<string>();
      const map = new Map<string, MessageUIBlock[]>();
      const paired = new Set<number>();
      let hasLinkedUi = false;

      parts.forEach((part) => {
        if (part.type === "tool_call" && typeof part.callId === "string" && part.callId.trim().length > 0) {
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

      return { uiBlocksByCallId: map, pairedUiIndices: paired, hasCallLinkedUi: hasLinkedUi };
    }, [parts]);

    // 当非活跃消息的工具调用数量超过阈值时，将它们分组折叠展示
    const { shouldGroupTools, toolCallEntries, firstToolCallIndex } = useMemo(() => {
      const entries: Array<{ part: MessageToolCallBlock; index: number }> = [];
      parts.forEach((part, idx) => {
        if (part.type === 'tool_call') {
          entries.push({ part, index: idx });
        }
      });
      return {
        shouldGroupTools:
          entries.length > TOOL_GROUP_THRESHOLD ||
          (isActive && entries.length > 1),
        toolCallEntries: entries,
        firstToolCallIndex: entries.length > 0 ? entries[0].index : -1,
      };
    }, [parts, isActive]);
    const shouldRevealCallChain = useMemo(() => {
      if (hasContent) return true;
      if (toolCallEntries.length > 0) return true;
      if (stableActiveStep > 0) return true;
      if (stageHistory.length > 1) return true;
      if (statusStage && statusStage !== "listen") return true;
      return false;
    }, [hasContent, stageHistory.length, stableActiveStep, statusStage, toolCallEntries.length]);
    const hasToolActivity = useMemo(
      () => toolCallEntries.length > 0 || pairedResultIndices.size > 0 || hasCallLinkedUi,
      [hasCallLinkedUi, pairedResultIndices.size, toolCallEntries.length]
    );
    const statusRailCompleted = !isActive && (hasContent || hasToolActivity);
    const liveStatusLabel = useMemo(() => {
      if (statusRailCompleted) {
        return t("status.header.completed");
      }
      return t(streamEnabled ? "status.header.answering" : "status.header.processing");
    }, [statusRailCompleted, streamEnabled, t]);
    const terminalPlaceholder = useMemo(
      () => t("status.placeholder.waiting"),
      [t]
    );
    const shouldShowStatusRail = isActive || hasContent || hasToolActivity || Boolean(statusStage);
    const displayedStepIndex = statusRailCompleted ? steps.length - 1 : stableActiveStep;
    const terminalDetail = isActive ? stableDetail ?? statusDetail : null;

    const consoleTitle = useMemo(() => {
      for (const part of parts) {
        if (part.type === "execution_section") {
          const title = typeof part.title === "string" ? part.title.trim() : "";
          if (title) return title;
        }
      }
      return "Code Execution";
    }, [parts]);

    const shouldShowSandboxLabelForConsole = useCallback((nextPartIndex: number) => {
      const nextPart = parts[nextPartIndex];
      if (!nextPart) return false;
      if (nextPart.type !== "tool_call" && nextPart.type !== "tool_result") return false;
      return nextPart.toolName === "execute_code_plan";
    }, [parts]);

    return (
      <div
        className={cn(
          "w-full max-w-full text-[15px] leading-relaxed",
          "border-l-[3px] border-l-primary/25 dark:border-l-primary/35",
          "text-foreground overflow-hidden"
        )}
        data-slot="glass-card"
        >
          <div className="pl-4 pr-1 py-2 min-w-0 overflow-hidden">
            {shouldShowStatusRail ? (
              <motion.div
                key="terminal-stream"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-4"
              >
                <TerminalStream
                  steps={steps}
                  activeIndex={displayedStepIndex}
                  label={streamEnabled ? t("status.flow.stream") : t("status.flow.batch")}
                  statusLabel={liveStatusLabel}
                  placeholder={terminalPlaceholder}
                  showPlaceholder={!shouldRevealCallChain}
                  detail={terminalDetail}
                  detailRepeat={Math.max(detailRepeat, repeatCountFromMeta)}
                  compact={hasContent || hasToolActivity}
                  completed={statusRailCompleted}
                />
              </motion.div>
            ) : null}

            {hasContent && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
                className="space-y-3"
              >
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

                  if (part.type === 'capability_transition') {
                    return (
                      <motion.div
                        key={`capability-transition-${index}`}
                        initial={{ y: 8, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ type: "spring", stiffness: 120, damping: 18 }}
                      >
                        <CapabilityTransitionCard
                          action={part.action}
                          capabilityName={part.capabilityName}
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
                              uiBlocksByCallId={uiBlocksByCallId}
                              isActive={isActive}
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
                          callId={part.callId}
                          name={part.toolName}
                          args={part.toolArgs}
                          status={part.status}
                          resultBlock={part.callId ? resultMap.get(part.callId) : undefined}
                          uiBlocks={part.callId ? uiBlocksByCallId.get(part.callId) : undefined}
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
                    if (pairedUiIndices.has(index)) return null;
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
	                    let nextPartIndex = parts.length;
	                    for (let i = index; i < parts.length; i++) {
	                      if (parts[i].type === 'console_log' || parts[i].type === 'execution_section') {
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
                  const partContent = getRenderableBlockContent(part);
                  if (!partContent) return null;

                  return (
                    <motion.div
                      key={`text-${index}`}
                      initial={{ y: 8, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{ type: "spring", stiffness: 120, damping: 18 }}
                    >
                      <TypingTextBlock
                        content={partContent}
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
              </motion.div>
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
      return JSON.stringify(serializeComparableBlock(prevPart)) !== JSON.stringify(serializeComparableBlock(nextPart));
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

const CapabilityTransitionCard = memo<{
  action?: "activated" | "deactivated" | "updated";
  capabilityName?: string;
  reason?: string;
}>(
  function CapabilityTransitionCard({ action, capabilityName, reason }) {
    const title =
      action === "activated"
        ? `已启用专家能力${capabilityName ? `：${capabilityName}` : ""}`
        : action === "deactivated"
          ? `已退出专家能力${capabilityName ? `：${capabilityName}` : ""}`
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
  }
);

// === 组件：MCP 工具块（可折叠展示结果） ===
const ToolCallBlock = memo<{
  callId?: string;
  name?: string;
  args?: string;
  status?: string;
  resultBlock?: MessageToolResultBlock;
  uiBlocks?: MessageUIBlock[];
}>(
  function ToolCallBlock({ callId, name, args, status, resultBlock, uiBlocks = [] }) {
    const t = useI18n("chat");
    const [isOpen, setIsOpen] = useState(false);
    const cardRef = useRef<HTMLDivElement>(null);
    const recentApprovedExecution = useBridgeApprovalStore((state) => state.recentApprovedExecution);
    const hasResult = !!resultBlock;
    const hasUi = uiBlocks.length > 0;
    const hasExpandableContent = hasResult || hasUi;
    const isRecentlyApproved =
      typeof callId === "string" &&
      callId.length > 0 &&
      recentApprovedExecution?.call_id === callId;

    useEffect(() => {
      if (!isRecentlyApproved) return;
      const frame = requestAnimationFrame(() => {
        cardRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      });
      return () => cancelAnimationFrame(frame);
    }, [isRecentlyApproved]);

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
    const shellExecutionInsight = useMemo(
      () => extractShellExecutionInsight(resultBlock?.toolName || name, resultBlock?.result),
      [resultBlock?.toolName, name, resultBlock?.result]
    );
    const visualState = useMemo(
      () => resolveToolVisualState(status, resultBlock),
      [resultBlock, status]
    );
    const preview = useMemo(
      () => resolveToolPreview(args, resultBlock, uiBlocks),
      [args, resultBlock, uiBlocks]
    );

    const resultContent = useMemo(() => {
      return formatObjectAsMarkdown(resultBlock?.result);
    }, [resultBlock?.result]);

    const isResultError = resultBlock?.status === "error";
    const isResultPendingApproval = Boolean(resultBlock && isToolApprovalResultBlock(resultBlock));

    useEffect(() => {
      if (!hasUi && !taskLiveId) return;
      setIsOpen(true);
    }, [hasUi, taskLiveId]);

    const card = (
      <div ref={cardRef} className="w-full">
        <div className="flex items-stretch gap-3">
          <div className="flex w-5 shrink-0 flex-col items-center">
            <div className="pt-0.5">
              <ToolStateGlyph state={visualState} />
            </div>
            {hasExpandableContent ? (
              <span
                className={cn(
                  "mt-1 w-px flex-1 min-h-4",
                  visualState === "error"
                    ? "bg-red-200 dark:bg-red-900"
                    : visualState === "success"
                      ? "bg-emerald-200 dark:bg-emerald-900"
                      : visualState === "pending"
                        ? "bg-amber-200 dark:bg-amber-900"
                        : "bg-blue-200 dark:bg-blue-900"
                )}
              />
            ) : null}
          </div>

          <div
            className={cn(
              "min-w-0 flex-1 rounded-2xl border px-3 py-2.5 text-sm transition-all duration-300",
              visualState === "running" &&
                "border-blue-200/80 bg-blue-50/55 dark:border-blue-900 dark:bg-blue-950/20",
              visualState === "success" && "border-slate-200/80 bg-white/85 dark:border-zinc-800 dark:bg-zinc-900/70",
              visualState === "pending" && "border-slate-200/80 bg-white/80 dark:border-zinc-800 dark:bg-zinc-900/65",
              visualState === "error" &&
                "border-red-200/80 bg-red-50/55 dark:border-red-900 dark:bg-red-950/20",
              isRecentlyApproved &&
                "border-emerald-300 bg-emerald-50/80 shadow-[0_0_0_3px_rgba(16,185,129,0.14)] dark:border-emerald-700 dark:bg-emerald-950/25",
              hasExpandableContent && "cursor-pointer select-none hover:bg-muted/30"
            )}
          >
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-semibold text-foreground">
                    {humanizeToolName(name)}
                  </span>
                  <Badge variant="outline" className="h-5 text-[10px] font-normal text-muted-foreground">
                    {isInternalTool(name) ? "Skill" : "MCP"}
                  </Badge>
                  {isRecentlyApproved ? (
                    <Badge
                      variant="outline"
                      className="h-5 border-emerald-300 text-[10px] font-normal text-emerald-700 dark:border-emerald-700 dark:text-emerald-300"
                    >
                      {t("approvalDialog.badges.approved")}
                    </Badge>
                  ) : null}
                </div>
                {preview ? (
                  <div className="mt-1 truncate text-[12px] leading-5 text-muted-foreground">
                    {preview}
                  </div>
                ) : null}
              </div>

              {hasExpandableContent ? (
                <div className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-muted-foreground">
                  <span>{t(isOpen ? "toolGroup.collapse" : "toolGroup.expand")}</span>
                  <ChevronDown size={14} className={cn("transition-transform duration-200", !isOpen && "-rotate-90")} />
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    );

    if (!hasExpandableContent) return card;

    return (
      <Collapsible open={isOpen} onOpenChange={setIsOpen} className="w-full">
        <CollapsibleTrigger asChild>
          {card}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 ml-8">
            {taskLiveId ? (
              <TaskLiveBlock taskId={taskLiveId} />
            ) : skillInstallInsight ? (
              <SkillInstallStatusCard insight={skillInstallInsight} />
            ) : shellExecutionInsight ? (
              <div className={cn(
                "rounded-2xl border p-3 text-sm overflow-hidden",
                isResultError
                  ? "border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-900/20"
                  : isResultPendingApproval
                    ? "border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-900/20"
                    : "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-900/20"
              )}>
                <ShellExecutionResultCard insight={shellExecutionInsight} />
                <ToolDebugPanel debug={resultBlock?.debug} />
              </div>
            ) : hasUi ? (
              <div className="space-y-3">
                {uiBlocks.map((uiBlock, index) => (
                  <div
                    key={uiBlock.id || `${callId || name || "tool"}-ui-${index}`}
                    className={cn(
                      "overflow-hidden rounded-2xl",
                      uiBlock.viewType === "html.v1"
                        ? "border-transparent bg-transparent p-0"
                        : "border border-border/80 bg-background/80 p-2"
                    )}
                  >
                    <ViewBlock
                      viewType={uiBlock.viewType}
                      payload={uiBlock.payload}
                      title={uiBlock.title}
                      metadata={uiBlock.metadata}
                    />
                  </div>
                ))}
                <ToolDebugPanel debug={resultBlock?.debug} />
              </div>
            ) : (
              <div
                className={cn(
                  "rounded-2xl border p-3 text-sm overflow-hidden",
                  isResultError
                    ? "border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-900/20"
                    : isResultPendingApproval
                      ? "border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-900/20"
                      : "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-900/20"
                )}
              >
                <div className="mb-2 flex items-center justify-between">
                  <div className="font-mono text-xs font-semibold truncate">
                    {resultBlock?.toolName || resultBlock?.callId || "result"}
                  </div>
                  <Badge variant="outline" className="h-5 text-[10px] font-normal shrink-0">
                    {isResultError ? "ERROR" : isResultPendingApproval ? "APPROVAL" : "OUTPUT"}
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
  toolCalls: Array<{ part: MessageToolCallBlock; index: number }>;
  resultMap: Map<string, MessageToolResultBlock>;
  uiBlocksByCallId: Map<string, MessageUIBlock[]>;
  isActive: boolean;
}>(
  function ToolCallGroup({ toolCalls, resultMap, uiBlocksByCallId, isActive }) {
    const [isOpen, setIsOpen] = useState(isActive);
    const groupRef = useRef<HTMLDivElement>(null);
    const t = useI18n("chat");
    const recentApprovedCallId = useBridgeApprovalStore(
      (state) => state.recentApprovedExecution?.call_id ?? null
    );
    const containsRecentApproval = useMemo(
      () => toolCalls.some(({ part }) => part.callId === recentApprovedCallId),
      [recentApprovedCallId, toolCalls]
    );
    const hasResolvedResult = useMemo(
      () =>
        toolCalls.some(({ part }) => {
          const callId = typeof part.callId === "string" ? part.callId : "";
          if (!callId) return false;
          return resultMap.has(callId) || (uiBlocksByCallId.get(callId)?.length ?? 0) > 0;
        }),
      [resultMap, toolCalls, uiBlocksByCallId]
    );
    const hasPendingApproval = useMemo(
      () =>
        toolCalls.some(({ part }) => {
          if (part.status === "requires_approval") return true;
          const callId = typeof part.callId === "string" ? part.callId : "";
          if (!callId) return false;
          const resultBlock = resultMap.get(callId);
          return Boolean(resultBlock && isToolApprovalResultBlock(resultBlock));
        }),
      [resultMap, toolCalls]
    );

    useEffect(() => {
      if (isActive || containsRecentApproval || hasResolvedResult) {
        setIsOpen(true);
      }
    }, [containsRecentApproval, hasResolvedResult, isActive]);

    useEffect(() => {
      if (!containsRecentApproval) return;
      const frame = requestAnimationFrame(() => {
        groupRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      });
      return () => cancelAnimationFrame(frame);
    }, [containsRecentApproval]);

    const summary = useMemo(() => {
      const pseudoParts: MessageBlock[] = toolCalls.map(({ part }) => part);
      return summarizeToolCalls(pseudoParts);
    }, [toolCalls]);
    const summaryKey = isActive
      ? summary?.allInternal
        ? "toolGroup.liveSkillSummary"
        : "toolGroup.liveSummary"
      : summary?.allInternal
        ? "toolGroup.skillSummary"
        : "toolGroup.summary";
    const groupState: ToolVisualState = isActive ? "running" : hasPendingApproval ? "pending" : hasResolvedResult ? "success" : "pending";

    return (
      <Collapsible open={isOpen} onOpenChange={setIsOpen} className="w-full">
        <CollapsibleTrigger asChild>
          <div
            ref={groupRef}
            className={cn(
              "w-full rounded-2xl border px-3 py-2.5 text-sm transition-all cursor-pointer select-none hover:bg-muted/30",
              groupState === "running" &&
                "border-blue-200/80 bg-blue-50/55 dark:border-blue-900 dark:bg-blue-950/20",
              groupState === "success" &&
                "border-slate-200/80 bg-white/82 dark:border-zinc-800 dark:bg-zinc-900/70",
              groupState === "pending" &&
                "border-slate-200/80 bg-white/80 dark:border-zinc-800 dark:bg-zinc-900/65",
              containsRecentApproval &&
                "border-emerald-300 bg-emerald-50/70 shadow-[0_0_0_3px_rgba(16,185,129,0.14)] dark:border-emerald-700 dark:bg-emerald-950/20"
            )}
          >
            <div className="flex items-start gap-3">
              <div className="pt-0.5">
                <ToolStateGlyph state={groupState} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">
                    {t(summaryKey, { count: toolCalls.length })}
                  </span>
                  <Badge variant="outline" className="h-5 text-[10px] font-normal text-muted-foreground">
                    {summary?.allInternal ? "Skill" : "MCP"}
                  </Badge>
                </div>
                <div className="mt-1 truncate text-[12px] text-muted-foreground">
                  {summary?.highlights || "-"}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-muted-foreground">
                <span>{t(isOpen ? "toolGroup.collapse" : "toolGroup.expand")}</span>
                <ChevronDown size={14} className={cn("transition-transform duration-200", !isOpen && "-rotate-90")} />
              </div>
            </div>
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-3 space-y-2">
            {toolCalls.map(({ part, index }) => (
              <ToolCallBlock
                key={`tool-${index}`}
                callId={part.callId}
                name={part.toolName}
                args={part.toolArgs}
                status={part.status}
                resultBlock={part.callId ? resultMap.get(part.callId) : undefined}
                uiBlocks={part.callId ? uiBlocksByCallId.get(part.callId) : undefined}
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
  status?: "success" | "error" | "requires_approval";
  result?: unknown;
  debug?: Record<string, unknown>;
}>(function ToolResultBlock({ name, callId, status, result, debug }) {
  const t = useI18n("chat");
  const [isOpen, setIsOpen] = useState(false);
  const title = humanizeToolName(name) || callId || "tool_result";
  const isError = status === "error";
  const isPendingApproval = isToolApprovalResultBlock({
    id: callId || "tool-result",
    type: "tool_result",
    callId,
    toolName: name,
    status,
    result,
  } as MessageBlock);
  const skillInstallInsight = useMemo(
    () => extractSkillInstallInsight(name, result),
    [name, result]
  );
  const shellExecutionInsight = useMemo(
    () => extractShellExecutionInsight(name, result),
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
  const preview = useMemo(() => {
    const shellPreview = shellExecutionInsight
      ? summarizeShellExecutionInsight(shellExecutionInsight)
      : null;
    return shellPreview || summarizeUnknownValue(result);
  }, [result, shellExecutionInsight]);
  const visualState: ToolVisualState = isError ? "error" : isPendingApproval ? "pending" : "success";

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="w-full">
      <CollapsibleTrigger asChild>
        <div className="w-full">
          <div className="flex items-stretch gap-3">
            <div className="flex w-5 shrink-0 flex-col items-center">
              <div className="pt-0.5">
                <ToolStateGlyph state={visualState} />
              </div>
              <span
                className={cn(
                  "mt-1 w-px flex-1 min-h-4",
                  isError
                    ? "bg-red-200 dark:bg-red-900"
                    : isPendingApproval
                      ? "bg-amber-200 dark:bg-amber-900"
                      : "bg-emerald-200 dark:bg-emerald-900"
                )}
              />
            </div>
            <div
              className={cn(
                "min-w-0 flex-1 rounded-2xl border px-3 py-2.5 text-sm transition-all cursor-pointer select-none hover:bg-muted/30",
                isError
                  ? "border-red-200/80 bg-red-50/55 dark:border-red-900 dark:bg-red-950/20"
                  : isPendingApproval
                    ? "border-amber-200/80 bg-amber-50/55 dark:border-amber-900 dark:bg-amber-950/20"
                    : "border-slate-200/80 bg-white/85 dark:border-zinc-800 dark:bg-zinc-900/70"
              )}
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-semibold text-foreground">{title}</span>
                    <Badge variant="outline" className="h-5 text-[10px] font-normal text-muted-foreground shrink-0">
                      {isError ? "ERROR" : isPendingApproval ? "APPROVAL" : "OUTPUT"}
                    </Badge>
                  </div>
                  {preview ? (
                    <div className="mt-1 truncate text-[12px] text-muted-foreground">
                      {preview}
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-muted-foreground">
                  <span>{t(isOpen ? "toolGroup.collapse" : "toolGroup.expand")}</span>
                  <ChevronDown size={14} className={cn("transition-transform duration-200", !isOpen && "-rotate-90")} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 ml-8">
          <div className={cn(
            "rounded-2xl border p-3 text-sm overflow-hidden",
            isError
              ? "border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-900/20"
              : isPendingApproval
                ? "border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-900/20"
                : "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-900/20"
          )}>
            {skillInstallInsight ? (
              <SkillInstallStatusCard insight={skillInstallInsight} />
            ) : shellExecutionInsight ? (
              <ShellExecutionResultCard insight={shellExecutionInsight} />
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
const ExecutionConsole = memo<{
  blocks: MessageBlock[];
  isActive: boolean;
  showSandboxLabel: boolean;
  title: string;
}>(
  function ExecutionConsole({ blocks, isActive, showSandboxLabel, title }) {
    const [isExpanded, setIsOpen] = useState(isActive);
    const scrollRef = useRef<HTMLDivElement>(null);

    // Auto-expand when execution starts
    useEffect(() => {
      if (isActive) setIsOpen(true);
    }, [isActive]);

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
              {showSandboxLabel ? "SANDBOX EXECUTION" : title}
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
                  return null;
                }
                if (block.type === 'console_log') {
                  const isError = block.stream === 'stderr';
                  return (
                    <div key={i} className={cn(
                      "whitespace-pre-wrap break-all",
                      isError ? "text-red-500" : "text-zinc-600 dark:text-zinc-400"
                    )}>
                      <span className="opacity-30 mr-2 select-none">|</span>
                      {block.content}
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
