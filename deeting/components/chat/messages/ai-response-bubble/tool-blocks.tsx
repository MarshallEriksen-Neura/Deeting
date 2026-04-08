"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Loader2,
  Terminal,
  Zap,
} from "lucide-react";
import dynamic from "next/dynamic";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MarkdownViewer } from "@/components/chat/markdown-viewer";
import { TaskLiveBlock } from "@/components/chat/messages/task-live-block";
import { isToolApprovalResultBlock } from "@/lib/chat/assistant-activity";
import { useBridgeApprovalStore } from "@/lib/chat/bridge-approval-store";
import {
  humanizeToolName as sharedHumanizeToolName,
  isInternalTool as sharedIsInternalTool,
  resolveToolPreview as sharedResolveToolPreview,
  resolveToolResultPreview as sharedResolveToolResultPreview,
  resolveToolResultTitle as sharedResolveToolResultTitle,
  summarizeToolCalls as sharedSummarizeToolCalls,
} from "@/lib/chat/tool-ux";
import {
  buildBridgeToolApprovalFromResult,
  createOptimisticApprovalExecutionBlocks,
} from "@/lib/chat/tool-approval";
import { useI18n } from "@/hooks/use-i18n";
import type {
  MessageBlock,
  UIBlock as MessageUIBlock,
  ToolCallBlock as MessageToolCallBlock,
  ToolResultBlock as MessageToolResultBlock,
} from "@/lib/chat/message-protocol";
import { useChatStore } from "@/store/chat-store";
import { cn } from "@/lib/utils";

import {
  runInlineApproval,
  runInlineRejection,
} from "@/components/chat/messages/ai-response-bubble/inline-approval";

const ViewBlock = dynamic(() => import("@/components/views/view-block"), {
  ssr: false,
});

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

type ToolVisualState = "running" | "success" | "error" | "pending";

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function extractRuntimeToolTrace(
  debug?: Record<string, unknown>,
): RuntimeToolTraceItem[] {
  if (!debug) return [];
  const runtimeToolCalls = toRecord(debug.runtime_tool_calls);
  if (!runtimeToolCalls) return [];
  const rawCalls = runtimeToolCalls.calls;
  if (!Array.isArray(rawCalls)) return [];

  const normalized: RuntimeToolTraceItem[] = [];
  for (let i = 0; i < rawCalls.length; i += 1) {
    const entry = toRecord(rawCalls[i]);
    if (!entry) continue;
    const toolName =
      typeof entry.tool_name === "string" ? entry.tool_name.trim() : "";
    if (!toolName) continue;
    const index = toNumber(entry.index);
    const status = typeof entry.status === "string" ? entry.status.trim() : "";
    const durationMs = toNumber(entry.duration_ms);
    const error = typeof entry.error === "string" ? entry.error.trim() : "";
    const errorCode =
      typeof entry.error_code === "string" ? entry.error_code.trim() : "";
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
    executionId:
      typeof debug.execution_id === "string" ? debug.execution_id : null,
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
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

function extractSkillInstallInsight(
  toolName?: string,
  result?: unknown,
): SkillInstallInsight | null {
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

function extractShellExecutionInsight(
  toolName?: string,
  result?: unknown,
): ShellExecutionInsight | null {
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

function summarizeShellExecutionInsight(
  insight: ShellExecutionInsight,
): string | null {
  const parts: string[] = [];
  if (insight.resolvedProgram) parts.push(insight.resolvedProgram);
  if (insight.shellFamily) parts.push(insight.shellFamily);
  if (insight.exitCode !== null) parts.push(`exit ${insight.exitCode}`);

  const encodings = [insight.encodingStdout, insight.encodingStderr].filter(
    (value, index, values): value is string =>
      !!value && values.indexOf(value) === index,
  );
  if (encodings.length > 0) {
    parts.push(`enc ${encodings.join("/")}`);
  }

  if (insight.durationMs !== null) {
    parts.push(`${insight.durationMs}ms`);
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}

function toInlinePreview(value: string, maxLength = 96): string | null {
  const normalized = value
    .replace(/```json/gi, " ")
    .replace(/```/g, " ")
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
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
        .join(" 路 "),
    );
  }

  const record = toRecord(value);
  if (record) {
    for (const key of [
      "summary",
      "message",
      "title",
      "status",
      "text",
      "content",
      "error",
    ]) {
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

function resolveToolVisualState(
  status?: string,
  resultBlock?: MessageToolResultBlock,
): ToolVisualState {
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
          "border-slate-200 bg-white/90 text-slate-400 dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-500",
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

const SkillInstallStatusCard = memo<{ insight: SkillInstallInsight }>(
  function SkillInstallStatusCard({ insight }) {
    if (insight.state === "pending_approval") {
      return (
        <div className="rounded-lg border border-amber-300 bg-amber-50/70 p-3 dark:border-amber-900 dark:bg-amber-900/20">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-xs font-semibold text-amber-800 dark:text-amber-200">
              Skill install pending approval
            </div>
            <Badge
              variant="outline"
              className="h-5 text-[10px] font-normal text-amber-700 dark:text-amber-300"
            >
              APPROVAL
            </Badge>
          </div>
          <div className="space-y-1 text-[11px] text-amber-900/90 dark:text-amber-200/90">
            {insight.skillName ? (
              <div>
                Skill: <span className="font-mono">{insight.skillName}</span>
              </div>
            ) : null}
            {insight.repoUrl ? (
              <div>
                Repo:{" "}
                <span className="font-mono break-all">{insight.repoUrl}</span>
              </div>
            ) : null}
            {insight.riskLevel ? (
              <div>
                Risk: <span className="font-mono">{insight.riskLevel}</span>
              </div>
            ) : null}
            {insight.approvalToken ? (
              <div>
                Token:{" "}
                <span className="font-mono">
                  {insight.approvalToken.slice(0, 8)}...
                </span>
              </div>
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
          <Badge
            variant="outline"
            className="h-5 text-[10px] font-normal text-emerald-700 dark:text-emerald-300"
          >
            READY
          </Badge>
        </div>
        <div className="space-y-1 text-[11px] text-emerald-900/90 dark:text-emerald-200/90">
          {insight.skillName ? (
            <div>
              Skill: <span className="font-mono">{insight.skillName}</span>
            </div>
          ) : null}
          {insight.repoUrl ? (
            <div>
              Repo:{" "}
              <span className="font-mono break-all">{insight.repoUrl}</span>
            </div>
          ) : null}
          {insight.indexedTools !== null ? (
            <div>
              Indexed tools:{" "}
              <span className="font-mono">{insight.indexedTools}</span>
            </div>
          ) : null}
        </div>
      </div>
    );
  },
);

const ShellExecutionResultCard = memo<{ insight: ShellExecutionInsight }>(
  function ShellExecutionResultCard({ insight }) {
    const encodingSummary = [insight.encodingStdout, insight.encodingStderr]
      .filter(
        (value, index, values): value is string =>
          !!value && values.indexOf(value) === index,
      )
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
              Command:{" "}
              <span className="font-mono break-all">{insight.command}</span>
            </div>
          ) : null}
          {insight.workingDir ? (
            <div>
              Working dir:{" "}
              <span className="font-mono break-all">{insight.workingDir}</span>
            </div>
          ) : null}
          {encodingSummary ? (
            <div>
              Encoding: <span className="font-mono">{encodingSummary}</span>
            </div>
          ) : null}
          {insight.approvalLevel ? (
            <div>
              Approval:{" "}
              <span className="font-mono">{insight.approvalLevel}</span>
            </div>
          ) : null}
        </div>

        {insight.warnings.length > 0 ? (
          <div className="mt-3 rounded-md border border-amber-300/80 bg-amber-50/70 p-2 dark:border-amber-900 dark:bg-amber-950/20">
            <div className="mb-1 text-[11px] font-semibold text-amber-800 dark:text-amber-200">
              Warnings
            </div>
            <div className="space-y-1 text-[11px] text-amber-900/90 dark:text-amber-200/90">
              {insight.warnings.map((warning, index) => (
                <div key={`warning-${index}`}>{warning}</div>
              ))}
            </div>
          </div>
        ) : null}

        {insight.diagnostics.length > 0 ? (
          <div className="mt-3 rounded-md border border-sky-300/80 bg-sky-50/70 p-2 dark:border-sky-900 dark:bg-sky-950/20">
            <div className="mb-1 text-[11px] font-semibold text-sky-800 dark:text-sky-200">
              Diagnostics
            </div>
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
  },
);

function ToolDebugPanel({ debug }: { debug?: Record<string, unknown> }) {
  const [isOpen, setIsOpen] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
    "idle",
  );
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
            className={cn(
              "text-amber-700 transition-transform duration-200 dark:text-amber-300",
              !isOpen && "-rotate-90",
            )}
          />
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 rounded-md border border-amber-200 bg-amber-50/40 p-2 dark:border-amber-900 dark:bg-amber-950/20">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="flex flex-wrap gap-1">
              {summary.executionId ? (
                <Badge
                  variant="outline"
                  className="h-5 text-[10px] font-normal"
                >
                  exec:{summary.executionId.slice(0, 8)}
                </Badge>
              ) : null}
              {summary.callCount !== null ? (
                <Badge
                  variant="outline"
                  className="h-5 text-[10px] font-normal"
                >
                  calls:{summary.callCount}
                </Badge>
              ) : null}
              {summary.renderCount !== null ? (
                <Badge
                  variant="outline"
                  className="h-5 text-[10px] font-normal"
                >
                  render:{summary.renderCount}
                </Badge>
              ) : null}
              {summary.sdkModule ? (
                <Badge
                  variant="outline"
                  className="h-5 text-[10px] font-normal"
                >
                  sdk:{summary.sdkModule}
                  {summary.sdkToolCount !== null
                    ? `(${summary.sdkToolCount})`
                    : ""}
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
                  : "border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-950/20",
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
                          <Badge
                            variant="outline"
                            className="h-5 text-[10px] font-normal"
                          >
                            {item.durationMs}ms
                          </Badge>
                        ) : null}
                        <Badge
                          variant="outline"
                          className={cn(
                            "h-5 text-[10px] font-normal shrink-0",
                            item.status === "success"
                              ? "border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300"
                              : item.status === "failed" ||
                                  item.status === "error"
                                ? "border-red-300 text-red-700 dark:border-red-800 dark:text-red-300"
                                : "border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-300",
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
              <MarkdownViewer
                content={rawContent}
                className="chat-markdown chat-markdown-assistant text-xs"
              />
            </div>
          </details>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export const ToolCallBlock = memo<{
  messageId?: string;
  callId?: string;
  name?: string;
  args?: string;
  status?: string;
  resultBlock?: MessageToolResultBlock;
  uiBlocks?: MessageUIBlock[];
}>(function ToolCallBlock({
  messageId,
  callId,
  name,
  args,
  status,
  resultBlock,
  uiBlocks = [],
}) {
  const t = useI18n("chat");
  const [isOpen, setIsOpen] = useState(false);
  const [approvalAction, setApprovalAction] = useState<
    "allow_once" | "deny_always" | null
  >(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const recentApprovedExecution = useBridgeApprovalStore(
    (state) => state.recentApprovedExecution,
  );
  const removePendingByToken = useBridgeApprovalStore(
    (state) => state.removePendingByToken,
  );
  const setMessageBlocks = useChatStore((state) => state.setMessageBlocks);
  const upsertMessageToolResult = useChatStore(
    (state) => state.upsertMessageToolResult,
  );
  const appendMessageBlocks = useChatStore((state) => state.appendMessageBlocks);
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

  const taskLiveId = useMemo(() => {
    if (!resultBlock || resultBlock.status === "error") return null;
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
    () =>
      extractSkillInstallInsight(
        resultBlock?.toolName || name,
        resultBlock?.result,
      ),
    [resultBlock?.toolName, name, resultBlock?.result],
  );
  const shellExecutionInsight = useMemo(
    () =>
      extractShellExecutionInsight(
        resultBlock?.toolName || name,
        resultBlock?.result,
      ),
    [resultBlock?.toolName, name, resultBlock?.result],
  );
  const visualState = useMemo(
    () => resolveToolVisualState(status, resultBlock),
    [resultBlock, status],
  );
  const preview = useMemo(
    () =>
      sharedResolveToolPreview({
        name,
        status,
        args,
        result: resultBlock?.result,
        uiBlocks,
        isPendingApproval: Boolean(
          resultBlock && isToolApprovalResultBlock(resultBlock),
        ),
        preferredPreview: shellExecutionInsight
          ? summarizeShellExecutionInsight(shellExecutionInsight)
          : null,
        translate: t,
      }),
    [args, name, resultBlock, shellExecutionInsight, status, t, uiBlocks],
  );
  const resultContent = useMemo(
    () => formatObjectAsMarkdown(resultBlock?.result),
    [resultBlock?.result],
  );

  const isResultError = resultBlock?.status === "error";
  const isResultPendingApproval = Boolean(
    resultBlock && isToolApprovalResultBlock(resultBlock),
  );
  const inlineApproval = useMemo(() => {
    if (!messageId || !callId || !resultBlock) return null;
    return buildBridgeToolApprovalFromResult(resultBlock.result, {
      tool_name: resultBlock.toolName ?? name,
      meta: {
        call_id: callId,
        message_id: messageId,
      },
    });
  }, [callId, messageId, name, resultBlock]);

  useEffect(() => {
    if (!hasUi && !taskLiveId) return;
    setIsOpen(true);
  }, [hasUi, taskLiveId]);

  const applyOptimisticExecutionState = useCallback(() => {
    if (!inlineApproval || !messageId) return;
    const message = useChatStore
      .getState()
      .messages.find((candidate) => candidate.id === messageId);
    if (!message?.blocks?.length) return;
    const nextBlocks = createOptimisticApprovalExecutionBlocks(
      inlineApproval,
      message.blocks,
    );
    if (nextBlocks !== message.blocks) {
      setMessageBlocks(messageId, nextBlocks);
    }
  }, [inlineApproval, messageId, setMessageBlocks]);

  const handleApprove = useCallback(async () => {
    if (!inlineApproval || !messageId) return;
    setApprovalAction("allow_once");
    try {
      await runInlineApproval({
        approval: inlineApproval,
        messageId,
        applyOptimisticExecutionState,
        removePendingByToken,
        upsertMessageToolResult,
        appendMessageBlocks,
      });
    } finally {
      setApprovalAction(null);
    }
  }, [
    appendMessageBlocks,
    applyOptimisticExecutionState,
    inlineApproval,
    messageId,
    removePendingByToken,
    upsertMessageToolResult,
  ]);

  const handleReject = useCallback(async () => {
    if (!inlineApproval || !messageId) return;
    setApprovalAction("deny_always");
    try {
      await runInlineRejection({
        approval: inlineApproval,
        messageId,
        rejectLabel: t("approvalDialog.result.userDeniedAlways"),
        removePendingByToken,
        upsertMessageToolResult,
      });
    } finally {
      setApprovalAction(null);
    }
  }, [
    inlineApproval,
    messageId,
    removePendingByToken,
    t,
    upsertMessageToolResult,
  ]);

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
                      : "bg-blue-200 dark:bg-blue-900",
              )}
            />
          ) : null}
        </div>

        <div
          className={cn(
            "min-w-0 flex-1 rounded-2xl border px-3 py-2.5 text-sm transition-all duration-300",
            visualState === "running" &&
              "border-blue-200/80 bg-blue-50/55 dark:border-blue-900 dark:bg-blue-950/20",
            visualState === "success" &&
              "border-slate-200/80 bg-white/85 dark:border-zinc-800 dark:bg-zinc-900/70",
            visualState === "pending" &&
              "border-slate-200/80 bg-white/80 dark:border-zinc-800 dark:bg-zinc-900/65",
            visualState === "error" &&
              "border-red-200/80 bg-red-50/55 dark:border-red-900 dark:bg-red-950/20",
            isRecentlyApproved &&
              "border-emerald-300 bg-emerald-50/80 shadow-[0_0_0_3px_rgba(16,185,129,0.14)] dark:border-emerald-700 dark:bg-emerald-950/25",
            hasExpandableContent &&
              "cursor-pointer select-none hover:bg-muted/30",
          )}
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm font-semibold text-foreground">
                  {sharedHumanizeToolName(name) ?? name ?? "Tool"}
                </span>
                <Badge
                  variant="outline"
                  className="h-5 text-[10px] font-normal text-muted-foreground"
                >
                  {sharedIsInternalTool(name) ? "Skill" : "MCP"}
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
              {inlineApproval ? (
                <div
                  className="mt-2 flex flex-wrap items-center gap-2"
                  onClick={(event) => event.stopPropagation()}
                >
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={approvalAction !== null}
                    onClick={() => void handleReject()}
                  >
                    {approvalAction === "deny_always" ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : null}
                    {t("approvalDialog.actions.reject")}
                  </Button>
                  <Button
                    size="sm"
                    disabled={approvalAction !== null}
                    onClick={() => void handleApprove()}
                  >
                    {approvalAction === "allow_once" ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : null}
                    {t("approvalDialog.actions.approve")}
                  </Button>
                </div>
              ) : null}
            </div>

            {hasExpandableContent ? (
              <div className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-muted-foreground">
                <span>
                  {t(isOpen ? "toolGroup.collapse" : "toolGroup.expand")}
                </span>
                <ChevronDown
                  size={14}
                  className={cn(
                    "transition-transform duration-200",
                    !isOpen && "-rotate-90",
                  )}
                />
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
      <CollapsibleTrigger asChild>{card}</CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 ml-8">
          {taskLiveId ? (
            <TaskLiveBlock taskId={taskLiveId} />
          ) : skillInstallInsight ? (
            <SkillInstallStatusCard insight={skillInstallInsight} />
          ) : shellExecutionInsight ? (
            <div
              className={cn(
                "rounded-2xl border p-3 text-sm overflow-hidden",
                isResultError
                  ? "border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-900/20"
                  : isResultPendingApproval
                    ? "border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-900/20"
                    : "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-900/20",
              )}
            >
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
                      : "border border-border/80 bg-background/80 p-2",
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
                    : "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-900/20",
              )}
            >
              <div className="mb-2 flex items-center justify-between">
                <div className="font-mono text-xs font-semibold truncate">
                  {resultBlock?.toolName || resultBlock?.callId || "result"}
                </div>
                <Badge
                  variant="outline"
                  className="h-5 text-[10px] font-normal shrink-0"
                >
                  {isResultError
                    ? "ERROR"
                    : isResultPendingApproval
                      ? "APPROVAL"
                      : "OUTPUT"}
                </Badge>
              </div>
              {preview ? (
                <div className="mb-3 rounded-xl bg-background/70 px-3 py-2 text-xs text-muted-foreground">
                  {preview}
                </div>
              ) : null}
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Raw output
              </div>
              {resultContent ? (
                <div className="overflow-x-auto">
                  <MarkdownViewer
                    content={resultContent}
                    className="chat-markdown chat-markdown-assistant text-sm"
                  />
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
});

export const ToolCallGroup = memo<{
  messageId?: string;
  toolCalls: Array<{ part: MessageToolCallBlock; index: number }>;
  resultMap: Map<string, MessageToolResultBlock>;
  uiBlocksByCallId: Map<string, MessageUIBlock[]>;
  isActive: boolean;
}>(function ToolCallGroup({
  messageId,
  toolCalls,
  resultMap,
  uiBlocksByCallId,
  isActive,
}) {
  const [isOpen, dispatchOpen] = useReducer(
    (state: boolean, action: "toggle" | "expand") =>
      action === "expand" ? true : !state,
    isActive,
  );
  const groupRef = useRef<HTMLDivElement>(null);
  const t = useI18n("chat");
  const recentApprovedCallId = useBridgeApprovalStore(
    (state) => state.recentApprovedExecution?.call_id ?? null,
  );
  const containsRecentApproval = useMemo(
    () => toolCalls.some(({ part }) => part.callId === recentApprovedCallId),
    [recentApprovedCallId, toolCalls],
  );
  const hasResolvedResult = useMemo(
    () =>
      toolCalls.some(({ part }) => {
        const callId = typeof part.callId === "string" ? part.callId : "";
        if (!callId) return false;
        return (
          resultMap.has(callId) ||
          (uiBlocksByCallId.get(callId)?.length ?? 0) > 0
        );
      }),
    [resultMap, toolCalls, uiBlocksByCallId],
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
    [resultMap, toolCalls],
  );

  useEffect(() => {
    if (isActive || containsRecentApproval || hasResolvedResult) {
      dispatchOpen("expand");
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
    return sharedSummarizeToolCalls(pseudoParts);
  }, [toolCalls]);
  const summaryKey = isActive
    ? summary?.allInternal
      ? "toolGroup.liveSkillSummary"
      : "toolGroup.liveSummary"
    : summary?.allInternal
      ? "toolGroup.skillSummary"
      : "toolGroup.summary";
  const groupState: ToolVisualState = isActive
    ? "running"
    : hasPendingApproval
      ? "pending"
      : hasResolvedResult
        ? "success"
        : "pending";

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={() => dispatchOpen("toggle")}
      className="w-full"
    >
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
              "border-emerald-300 bg-emerald-50/70 shadow-[0_0_0_3px_rgba(16,185,129,0.14)] dark:border-emerald-700 dark:bg-emerald-950/20",
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
                <Badge
                  variant="outline"
                  className="h-5 text-[10px] font-normal text-muted-foreground"
                >
                  {summary?.allInternal ? "Skill" : "MCP"}
                </Badge>
              </div>
              <div className="mt-1 truncate text-[12px] text-muted-foreground">
                {summary?.highlights || "-"}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-muted-foreground">
              <span>
                {t(isOpen ? "toolGroup.collapse" : "toolGroup.expand")}
              </span>
              <ChevronDown
                size={14}
                className={cn(
                  "transition-transform duration-200",
                  !isOpen && "-rotate-90",
                )}
              />
            </div>
          </div>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-3 space-y-2">
          {toolCalls.map(({ part, index }) => (
            <ToolCallBlock
              key={`tool-${index}`}
              messageId={messageId}
              callId={part.callId}
              name={part.toolName}
              args={part.toolArgs}
              status={part.status}
              resultBlock={part.callId ? resultMap.get(part.callId) : undefined}
              uiBlocks={
                part.callId ? uiBlocksByCallId.get(part.callId) : undefined
              }
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
});

export const ToolResultBlock = memo<{
  name?: string;
  callId?: string;
  status?: "success" | "error" | "requires_approval";
  result?: unknown;
  debug?: Record<string, unknown>;
}>(function ToolResultBlock({ name, callId, status, result, debug }) {
  const t = useI18n("chat");
  const [isOpen, setIsOpen] = useState(false);
  const title = sharedResolveToolResultTitle(name, callId);
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
    [name, result],
  );
  const shellExecutionInsight = useMemo(
    () => extractShellExecutionInsight(name, result),
    [name, result],
  );
  const content = useMemo(() => formatObjectAsMarkdown(result), [result]);
  const preview = useMemo(() => {
    const shellPreview = shellExecutionInsight
      ? summarizeShellExecutionInsight(shellExecutionInsight)
      : null;
    return (
      shellPreview ||
      sharedResolveToolResultPreview({
        name,
        result,
        isPendingApproval,
        translate: t,
      }) ||
      summarizeUnknownValue(result)
    );
  }, [isPendingApproval, name, result, shellExecutionInsight, t]);

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

  const visualState: ToolVisualState = isError
    ? "error"
    : isPendingApproval
      ? "pending"
      : "success";

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
                      : "bg-emerald-200 dark:bg-emerald-900",
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
                    : "border-slate-200/80 bg-white/85 dark:border-zinc-800 dark:bg-zinc-900/70",
              )}
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-semibold text-foreground">
                      {title}
                    </span>
                    <Badge
                      variant="outline"
                      className="h-5 text-[10px] font-normal text-muted-foreground shrink-0"
                    >
                      {isError
                        ? "ERROR"
                        : isPendingApproval
                          ? "APPROVAL"
                          : "OUTPUT"}
                    </Badge>
                  </div>
                  {preview ? (
                    <div className="mt-1 truncate text-[12px] text-muted-foreground">
                      {preview}
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-muted-foreground">
                  <span>
                    {t(isOpen ? "toolGroup.collapse" : "toolGroup.expand")}
                  </span>
                  <ChevronDown
                    size={14}
                    className={cn(
                      "transition-transform duration-200",
                      !isOpen && "-rotate-90",
                    )}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 ml-8">
          <div
            className={cn(
              "rounded-2xl border p-3 text-sm overflow-hidden",
              isError
                ? "border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-900/20"
                : isPendingApproval
                  ? "border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-900/20"
                  : "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-900/20",
            )}
          >
            {skillInstallInsight ? (
              <SkillInstallStatusCard insight={skillInstallInsight} />
            ) : shellExecutionInsight ? (
              <ShellExecutionResultCard insight={shellExecutionInsight} />
            ) : content ? (
              <>
                {preview ? (
                  <div className="mb-3 rounded-xl bg-background/70 px-3 py-2 text-xs text-muted-foreground">
                    {preview}
                  </div>
                ) : null}
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Raw output
                </div>
                <div className="overflow-x-auto">
                  <MarkdownViewer
                    content={content}
                    className="chat-markdown chat-markdown-assistant text-sm"
                  />
                </div>
              </>
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
