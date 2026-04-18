"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangle,
  CheckCircle2,
  Eraser,
  Loader2,
  Play,
  RotateCcw,
  Terminal,
} from "lucide-react"

import { CodeBlock } from "@/components/chat/code-block"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useI18n } from "@/hooks/use-i18n"
import {
  runLocalSandboxCodeSnippet,
  type SandboxSnippetLanguage,
  type SandboxSnippetRunResponse,
} from "@/lib/api/sandbox"
import type { ToolCallBlock, ToolResultBlock } from "@/lib/chat/message-protocol"
import { isTauriRuntime } from "@/lib/runtime/tauri"
import { cn } from "@/lib/utils"
import { useChatStore } from "@/store/chat-store"

const TOOL_NAME = "run_local_code_snippet"
const DEFAULT_EXECUTION_TIMEOUT_SECS = 30
const MAX_HISTORY_ITEMS = 8

const RUNNABLE_LANGUAGE_ALIASES: Record<string, SandboxSnippetLanguage> = {
  python: "python",
  py: "python",
  go: "go",
  golang: "go",
  rust: "rust",
  rs: "rust",
  java: "java",
}

type ResultTone = "success" | "error" | "neutral"

type RunHistoryItem = {
  key: string
  runNumber: number
  executedAt: number
  source: string
  result: SandboxSnippetRunResponse
}

type DiffLine = {
  kind: "context" | "add" | "remove"
  leftLine: number | null
  rightLine: number | null
  text: string
}

export function normalizeRunnableFenceLanguage(
  language?: string
): SandboxSnippetLanguage | null {
  const normalized = language?.trim().toLowerCase()
  if (!normalized) return null
  return RUNNABLE_LANGUAGE_ALIASES[normalized] ?? null
}

export function supportsRunnableFence(
  language: string | undefined,
  source: string
): boolean {
  return !!normalizeRunnableFenceLanguage(language) && source.trim().length > 0
}

export const buildRunnableFenceCallId = (messageId: string, fenceId: string) =>
  `${TOOL_NAME}:${messageId}:${fenceId}`

function formatRunTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(timestamp)
}

function buildSimpleLineDiff(previous: string, next: string): DiffLine[] {
  const previousLines = previous.split("\n")
  const nextLines = next.split("\n")
  const total = Math.max(previousLines.length, nextLines.length)
  const diff: DiffLine[] = []

  for (let index = 0; index < total; index += 1) {
    const previousLine = previousLines[index]
    const nextLine = nextLines[index]

    if (previousLine === nextLine) {
      diff.push({
        kind: "context",
        leftLine: previousLine !== undefined ? index + 1 : null,
        rightLine: nextLine !== undefined ? index + 1 : null,
        text: previousLine ?? nextLine ?? "",
      })
      continue
    }

    if (previousLine !== undefined) {
      diff.push({
        kind: "remove",
        leftLine: index + 1,
        rightLine: null,
        text: previousLine,
      })
    }
    if (nextLine !== undefined) {
      diff.push({
        kind: "add",
        leftLine: null,
        rightLine: index + 1,
        text: nextLine,
      })
    }
  }

  return diff
}

export function RunnableCodeFence({
  source,
  language,
  className,
  messageId,
  fenceId,
}: {
  source: string
  language?: string
  className?: string
  messageId: string
  fenceId: string
}) {
  const t = useI18n("chat")
  const sessionId = useChatStore((state) => state.sessionId)
  const appendMessageBlocks = useChatStore((state) => state.appendMessageBlocks)
  const upsertMessageToolResult = useChatStore(
    (state) => state.upsertMessageToolResult
  )
  const [isRunning, setIsRunning] = useState(false)
  const [editableSource, setEditableSource] = useState(source)
  const [activeResultTab, setActiveResultTab] = useState("stdout")
  const [runHistory, setRunHistory] = useState<RunHistoryItem[]>([])
  const [selectedHistoryKey, setSelectedHistoryKey] = useState<string | null>(null)
  const [outputCleared, setOutputCleared] = useState(false)
  const lastRunSourceRef = useRef(source)
  const runCounterRef = useRef(0)

  const runnableLanguage = useMemo(
    () => normalizeRunnableFenceLanguage(language),
    [language]
  )
  const callId = useMemo(
    () => buildRunnableFenceCallId(messageId, fenceId),
    [fenceId, messageId]
  )
  const toolCall = useChatStore(
    useCallback(
      (state) => {
        const message = state.messages.find((item) => item.id === messageId)
        const blocks = Array.isArray(message?.blocks) ? message.blocks : []
        return blocks.find(
          (block): block is ToolCallBlock =>
            block.type === "tool_call" &&
            block.callId === callId &&
            block.toolName === TOOL_NAME
        )
      },
      [callId, messageId]
    )
  )
  const toolResult = useChatStore(
    useCallback(
      (state) => {
        const message = state.messages.find((item) => item.id === messageId)
        const blocks = Array.isArray(message?.blocks) ? message.blocks : []
        return blocks.find(
          (block): block is ToolResultBlock =>
            block.type === "tool_result" &&
            block.callId === callId &&
            block.toolName === TOOL_NAME
        )
      },
      [callId, messageId]
    )
  )

  useEffect(() => {
    setEditableSource(source)
  }, [source])

  const canRun =
    !!sessionId &&
    !!runnableLanguage &&
    isTauriRuntime() &&
    editableSource.trim().length > 0

  const snippetResult = useMemo(() => {
    if (!toolResult?.result || typeof toolResult.result !== "object") {
      return null
    }
    return toolResult.result as SandboxSnippetRunResponse
  }, [toolResult])

  const resultKey = useMemo(
    () => {
      if (!toolResult) return null
      let payloadFingerprint = "empty"
      try {
        payloadFingerprint = JSON.stringify(toolResult.result ?? null)
      } catch {
        payloadFingerprint = String(toolResult.result ?? "empty")
      }
      return `${toolResult.id}:${toolResult.status ?? "unknown"}:${payloadFingerprint}`
    },
    [toolResult]
  )

  useEffect(() => {
    if (!resultKey || !snippetResult) {
      return
    }

    runCounterRef.current += 1
    const nextItem: RunHistoryItem = {
      key: resultKey,
      runNumber: runCounterRef.current,
      executedAt: Date.now(),
      source: lastRunSourceRef.current,
      result: snippetResult,
    }

    setRunHistory((previous) => {
      if (previous.some((item) => item.key === resultKey)) {
        return previous
      }
      return [nextItem, ...previous].slice(0, MAX_HISTORY_ITEMS)
    })
    setSelectedHistoryKey(resultKey)
    setOutputCleared(false)
  }, [resultKey, snippetResult])

  const latestHistory = runHistory[0] ?? null
  const selectedHistory = useMemo(
    () =>
      selectedHistoryKey
        ? runHistory.find((item) => item.key === selectedHistoryKey) ?? null
        : null,
    [runHistory, selectedHistoryKey]
  )
  const visibleHistory = outputCleared
    ? null
    : selectedHistory ?? latestHistory ?? null

  const visibleResult = visibleHistory?.result ?? snippetResult
  const visibleSource = visibleHistory?.source ?? lastRunSourceRef.current

  const stdoutText = useMemo(
    () => (visibleResult?.stdout ?? []).filter(Boolean).join("\n").trim(),
    [visibleResult]
  )
  const stderrText = useMemo(
    () => (visibleResult?.stderr ?? []).filter(Boolean).join("\n").trim(),
    [visibleResult]
  )
  const resultText = useMemo(
    () => (visibleResult?.result ?? []).filter(Boolean).join("\n").trim(),
    [visibleResult]
  )
  const nextActions = useMemo(
    () => visibleResult?.readiness?.next_actions?.filter(Boolean) ?? [],
    [visibleResult]
  )
  const outputLineCount = useMemo(() => {
    const aggregate = [stdoutText, stderrText, resultText].filter(Boolean).join("\n")
    if (!aggregate.trim()) return 0
    return aggregate.split("\n").length
  }, [resultText, stderrText, stdoutText])
  const lineCount = useMemo(
    () => Math.max(1, editableSource.replace(/\n$/, "").split("\n").length),
    [editableSource]
  )
  const isDirty = editableSource !== source

  const visualState = useMemo(() => {
    if (isRunning || toolCall?.status === "running") return "running"
    if (toolResult?.status === "error" || (visibleResult && !visibleResult.success)) {
      return "error"
    }
    if (toolResult?.status === "success" || visibleResult?.success) return "success"
    return "idle"
  }, [isRunning, toolCall?.status, toolResult?.status, visibleResult])

  const comparisonTarget = useMemo(() => {
    if (visibleHistory) {
      const currentIndex = runHistory.findIndex((item) => item.key === visibleHistory.key)
      if (currentIndex >= 0 && currentIndex < runHistory.length - 1) {
        return {
          label: `Run ${runHistory[currentIndex + 1].runNumber}`,
          source: runHistory[currentIndex + 1].source,
        }
      }
    }

    if (isDirty && editableSource !== visibleSource) {
      return {
        label: "current draft",
        source: editableSource,
      }
    }

    return null
  }, [editableSource, isDirty, runHistory, visibleHistory, visibleSource])

  const diffLines = useMemo(
    () =>
      comparisonTarget
        ? buildSimpleLineDiff(comparisonTarget.source, visibleSource)
        : [],
    [comparisonTarget, visibleSource]
  )

  useEffect(() => {
    if (stderrText) {
      setActiveResultTab("stderr")
      return
    }
    if (stdoutText) {
      setActiveResultTab("stdout")
      return
    }
    if (resultText) {
      setActiveResultTab("result")
      return
    }
    if (comparisonTarget) {
      setActiveResultTab("diff")
    }
  }, [comparisonTarget, resultText, stderrText, stdoutText])

  useEffect(() => {
    if (activeResultTab === "diff" && !comparisonTarget) {
      setActiveResultTab("stdout")
    }
  }, [activeResultTab, comparisonTarget])

  const executeRun = async (code: string) => {
    if (!sessionId || !runnableLanguage || isRunning || !code.trim()) return

    lastRunSourceRef.current = code
    setIsRunning(true)
    appendMessageBlocks(messageId, [
      {
        id: `${callId}-tool-call`,
        type: "tool_call",
        callId,
        toolName: TOOL_NAME,
        toolArgs: JSON.stringify({
          language: runnableLanguage,
          execution_timeout: DEFAULT_EXECUTION_TIMEOUT_SECS,
        }),
        status: "running",
      },
    ])

    try {
      const result = await runLocalSandboxCodeSnippet({
        sessionId,
        language: runnableLanguage,
        code,
        executionTimeoutSecs: DEFAULT_EXECUTION_TIMEOUT_SECS,
      })
      upsertMessageToolResult(messageId, {
        id: `${callId}-tool-result`,
        type: "tool_result",
        callId,
        toolName: TOOL_NAME,
        status: result.success ? "success" : "error",
        result,
      })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Local code snippet execution failed"
      upsertMessageToolResult(messageId, {
        id: `${callId}-tool-result`,
        type: "tool_result",
        callId,
        toolName: TOOL_NAME,
        status: "error",
        result: {
          success: false,
          status: "failed",
          language: runnableLanguage,
          image: "",
          sandbox_id: null,
          runtime_mode: "disabled",
          stdout: [],
          stderr: [],
          result: [],
          exit_code: null,
          error: message,
          error_code: "LOCAL_CODE_SNIPPET_INVOKE_FAILED",
          readiness: null,
        },
      })
    } finally {
      setIsRunning(false)
    }
  }

  const handleRun = async () => {
    if (!canRun) return
    await executeRun(editableSource)
  }

  const handleRunSelected = async () => {
    if (!visibleHistory) return
    await executeRun(visibleHistory.source)
  }

  const handleReset = () => {
    setEditableSource(source)
  }

  const handleLoadSelected = () => {
    if (!visibleHistory) return
    setEditableSource(visibleHistory.source)
  }

  const handleClearOutput = () => {
    setOutputCleared(true)
  }

  const handleEditorKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault()
      void handleRun()
    }
  }

  return (
    <div className="overflow-hidden rounded-[28px] border border-slate-200/80 bg-[linear-gradient(135deg,rgba(255,255,255,0.98),rgba(241,245,249,0.94))] shadow-[0_24px_60px_rgba(15,23,42,0.10)] dark:border-zinc-800 dark:bg-[linear-gradient(135deg,rgba(9,9,11,0.96),rgba(15,23,42,0.9))]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-4 py-3 dark:border-zinc-800">
        <div className="flex min-w-0 items-center gap-2">
          <Badge
            variant="outline"
            className="h-6 rounded-full px-2.5 text-[10px] uppercase tracking-[0.16em]"
          >
            {runnableLanguage?.toUpperCase() ?? language ?? "CODE"}
          </Badge>
          <Badge
            variant="outline"
            className="h-6 rounded-full px-2.5 text-[10px] font-normal text-muted-foreground"
          >
            local sandbox
          </Badge>
          {visibleResult?.image ? (
            <Badge
              variant="outline"
              className="h-6 rounded-full px-2.5 text-[10px] font-normal text-muted-foreground"
            >
              {visibleResult.image}
            </Badge>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {isDirty ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 rounded-full px-3 text-[11px] font-medium"
              onClick={handleReset}
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              Reset
            </Button>
          ) : null}
          <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            {visualState === "running"
              ? "Running"
              : visualState === "success"
                ? "Ready"
                : visualState === "error"
                  ? "Failed"
                  : "Editable"}
          </span>
          {canRun ? (
            <Button
              variant="secondary"
              size="sm"
              className="h-8 rounded-full px-3 text-[11px] font-medium"
              disabled={isRunning}
              onClick={() => void handleRun()}
            >
              {isRunning ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="mr-1.5 h-3.5 w-3.5" />
              )}
              {isRunning ? t("codeBlock.running") : t("codeBlock.run")}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-px bg-slate-200/80 md:grid-cols-[minmax(0,1.18fr)_minmax(380px,0.82fr)] dark:bg-zinc-800">
        <section className="min-w-0 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.09),transparent_38%),linear-gradient(180deg,rgba(15,23,42,0.96),rgba(9,9,11,0.98))] p-3 text-slate-50">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">
                Editor
              </div>
              <div className="mt-1 text-sm font-semibold text-slate-100">
                Editable buffer
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-full bg-rose-400/90" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-300/90" />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/90" />
              </div>
              <Badge className="border-slate-700 bg-slate-900/70 px-2.5 text-[10px] font-normal text-slate-300 shadow-none">
                {lineCount} lines
              </Badge>
              <Badge className="border-slate-700 bg-slate-900/70 px-2.5 text-[10px] font-normal text-slate-300 shadow-none">
                {isDirty ? "modified" : "synced"}
              </Badge>
              <Badge className="border-slate-700 bg-slate-900/70 px-2.5 text-[10px] font-normal text-slate-300 shadow-none">
                Ctrl/Cmd+Enter
              </Badge>
            </div>
          </div>
          <CodeBlock
            className={cn(className, "text-slate-100")}
            language={language}
            editableValue={editableSource}
            onEditableValueChange={setEditableSource}
            editableTextareaProps={{
              onKeyDown: handleEditorKeyDown,
              "aria-label": "runnable-code-editor",
            }}
          >
            {editableSource}
          </CodeBlock>
        </section>

        <section className="min-w-0 bg-[linear-gradient(180deg,rgba(248,250,252,0.96),rgba(241,245,249,0.92))] p-3 dark:bg-[linear-gradient(180deg,rgba(24,24,27,0.94),rgba(15,23,42,0.88))]">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-2xl border",
                  visualState === "running" &&
                    "border-sky-300 bg-sky-100 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300",
                  visualState === "success" &&
                    "border-emerald-300 bg-emerald-100 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
                  visualState === "error" &&
                    "border-red-300 bg-red-100 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300",
                  visualState === "idle" &&
                    "border-border bg-background text-muted-foreground dark:border-zinc-800 dark:bg-zinc-950/80"
                )}
              >
                {visualState === "running" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : visualState === "success" ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : visualState === "error" ? (
                  <AlertTriangle className="h-4 w-4" />
                ) : (
                  <Terminal className="h-4 w-4" />
                )}
              </div>
              <div>
                <div className="text-sm font-semibold text-foreground">Result</div>
                <div className="text-xs text-muted-foreground">
                  {visibleResult?.runtime_mode
                    ? `runtime: ${visibleResult.runtime_mode}`
                    : "Run the snippet to see sandbox output"}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {visibleHistory ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 rounded-full px-3 text-[11px] font-medium"
                  onClick={handleClearOutput}
                >
                  <Eraser className="mr-1.5 h-3.5 w-3.5" />
                  Clear
                </Button>
              ) : null}
              {visibleResult?.status ? (
                <Badge
                  variant="outline"
                  className="h-6 rounded-full px-2.5 text-[10px] font-normal"
                >
                  {visibleResult.status}
                </Badge>
              ) : null}
              {visibleResult?.exit_code !== undefined &&
              visibleResult?.exit_code !== null ? (
                <Badge
                  variant="outline"
                  className="h-6 rounded-full px-2.5 text-[10px]"
                >
                  exit {visibleResult.exit_code}
                </Badge>
              ) : null}
            </div>
          </div>

          <div className="space-y-3">
            {runHistory.length > 0 ? (
              <div className="space-y-2">
                <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Recent Runs
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {runHistory.map((item, index) => {
                    const isSelected = visibleHistory?.key === item.key && !outputCleared
                    return (
                      <button
                        key={item.key}
                        type="button"
                        className={cn(
                          "min-w-[120px] rounded-2xl border px-3 py-2 text-left transition-all",
                          isSelected
                            ? "border-slate-900 bg-slate-950 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-950"
                            : "border-border/80 bg-background/75 hover:bg-background dark:border-zinc-800 dark:bg-zinc-950/70 dark:hover:bg-zinc-950"
                        )}
                        onClick={() => {
                          setSelectedHistoryKey(item.key)
                          setOutputCleared(false)
                        }}
                        aria-label={`Run ${item.runNumber}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold">
                            Run {item.runNumber}
                          </span>
                          {index === 0 ? (
                            <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-emerald-300 dark:text-emerald-700">
                              latest
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 text-[11px] opacity-75">
                          {formatRunTimestamp(item.executedAt)}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : null}

            {visibleHistory ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-full px-3 text-[11px] font-medium"
                  onClick={handleLoadSelected}
                >
                  Load into editor
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-full px-3 text-[11px] font-medium"
                  onClick={() => void handleRunSelected()}
                  disabled={isRunning}
                >
                  <Play className="mr-1.5 h-3.5 w-3.5" />
                  Run selected
                </Button>
                {outputLineCount > 0 ? (
                  <Badge
                    variant="outline"
                    className="h-6 rounded-full px-2.5 text-[10px] font-normal"
                  >
                    {outputLineCount} output lines
                  </Badge>
                ) : null}
                {visibleResult?.sandbox_id ? (
                  <Badge
                    variant="outline"
                    className="h-6 rounded-full px-2.5 text-[10px] font-normal text-muted-foreground"
                  >
                    sandbox {visibleResult.sandbox_id}
                  </Badge>
                ) : null}
              </div>
            ) : null}

            {!visibleHistory && visualState === "idle" ? (
              <div className="rounded-2xl border border-dashed border-border/80 bg-background/70 px-4 py-5 text-sm text-muted-foreground dark:border-zinc-700 dark:bg-zinc-950/70">
                Edit the code on the left, then run it. Output stays pinned
                here instead of dropping into a separate tool result card below
                the message.
              </div>
            ) : null}

            {!visibleHistory && outputCleared ? (
              <div className="rounded-2xl border border-dashed border-border/80 bg-background/70 px-4 py-5 text-sm text-muted-foreground dark:border-zinc-700 dark:bg-zinc-950/70">
                Output cleared from view. Select a run above to inspect it again,
                or run the snippet once more.
              </div>
            ) : null}

            {visibleResult?.error ? (
              <div className="rounded-2xl border border-red-200/80 bg-red-50/70 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/30 dark:text-red-100">
                <div className="font-medium">{visibleResult.error}</div>
                {visibleResult.error_code ? (
                  <div className="mt-1 text-[11px] font-mono opacity-80">
                    {visibleResult.error_code}
                  </div>
                ) : null}
              </div>
            ) : null}

            {visibleHistory ? (
              <Tabs
                value={activeResultTab}
                onValueChange={setActiveResultTab}
                className="gap-3"
              >
                <TabsList className="h-auto w-full justify-start rounded-2xl border border-border/80 bg-background/75 p-1.5 dark:border-zinc-800 dark:bg-zinc-950/70">
                  <TabsTrigger
                    value="stdout"
                    className="rounded-xl px-3 py-1.5 text-xs"
                  >
                    stdout
                    {stdoutText ? (
                      <span className="ml-1.5 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-300">
                        live
                      </span>
                    ) : null}
                  </TabsTrigger>
                  <TabsTrigger
                    value="stderr"
                    className="rounded-xl px-3 py-1.5 text-xs"
                  >
                    stderr
                    {stderrText ? (
                      <span className="ml-1.5 rounded-full bg-red-500/15 px-1.5 py-0.5 text-[10px] text-red-700 dark:text-red-300">
                        issue
                      </span>
                    ) : null}
                  </TabsTrigger>
                  <TabsTrigger
                    value="result"
                    className="rounded-xl px-3 py-1.5 text-xs"
                  >
                    result
                    {resultText && resultText !== stdoutText ? (
                      <span className="ml-1.5 rounded-full bg-slate-500/15 px-1.5 py-0.5 text-[10px] text-slate-700 dark:text-slate-300">
                        value
                      </span>
                    ) : null}
                  </TabsTrigger>
                  {comparisonTarget ? (
                    <TabsTrigger
                      value="diff"
                      className="rounded-xl px-3 py-1.5 text-xs"
                    >
                      diff
                    </TabsTrigger>
                  ) : null}
                </TabsList>

                <TabsContent value="stdout" forceMount>
                  <ResultPaneSection
                    title="stdout"
                    tone="success"
                    content={stdoutText || "No stdout yet."}
                  />
                </TabsContent>
                <TabsContent value="stderr" forceMount>
                  <ResultPaneSection
                    title="stderr"
                    tone="error"
                    content={stderrText || "No stderr."}
                  />
                </TabsContent>
                <TabsContent value="result" forceMount>
                  <ResultPaneSection
                    title="result"
                    tone="neutral"
                    content={
                      (resultText && resultText !== stdoutText ? resultText : "") ||
                      "No structured result payload."
                    }
                  />
                </TabsContent>
                {comparisonTarget ? (
                  <TabsContent value="diff" forceMount>
                    <DiffPane
                      currentLabel={`Run ${visibleHistory.runNumber}`}
                      previousLabel={comparisonTarget.label}
                      lines={diffLines}
                    />
                  </TabsContent>
                ) : null}
              </Tabs>
            ) : null}

            {!stdoutText &&
            !stderrText &&
            !resultText &&
            visualState === "running" ? (
              <div className="rounded-2xl border border-sky-200/80 bg-sky-50/70 px-4 py-4 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-100">
                Sandbox is running this snippet...
              </div>
            ) : null}

            {nextActions.length > 0 ? (
              <div className="rounded-2xl border border-amber-200/80 bg-amber-50/70 px-4 py-3 dark:border-amber-900 dark:bg-amber-950/30">
                <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-amber-800 dark:text-amber-200">
                  Next Actions
                </div>
                <div className="space-y-1 text-sm text-amber-900 dark:text-amber-100">
                  {nextActions.map((action, index) => (
                    <div key={`${callId}-next-${index}`}>{action}</div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  )
}

function ResultPaneSection({
  title,
  content,
  tone,
}: {
  title: string
  content: string
  tone: ResultTone
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]",
        tone === "success" &&
          "border-emerald-200/80 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/30",
        tone === "error" &&
          "border-red-200/80 bg-red-50/70 dark:border-red-900 dark:bg-red-950/30",
        tone === "neutral" &&
          "border-border/80 bg-background/75 dark:border-zinc-800 dark:bg-zinc-950/70"
      )}
    >
      <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        {title}
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
        {content}
      </pre>
    </div>
  )
}

function DiffPane({
  currentLabel,
  previousLabel,
  lines,
}: {
  currentLabel: string
  previousLabel: string
  lines: DiffLine[]
}) {
  return (
    <div
      data-testid="runnable-diff-pane"
      className="rounded-2xl border border-border/80 bg-background/75 p-4 dark:border-zinc-800 dark:bg-zinc-950/70"
    >
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        <span>{currentLabel}</span>
        <span>vs</span>
        <span>{previousLabel}</span>
      </div>
      <div className="space-y-1 font-mono text-xs leading-6">
        {lines.map((line, index) => (
          <div
            key={`${line.kind}-${index}-${line.leftLine}-${line.rightLine}`}
            className={cn(
              "grid grid-cols-[56px_56px_20px_minmax(0,1fr)] gap-2 rounded-md px-2 py-0.5",
              line.kind === "add" &&
                "bg-emerald-50 text-emerald-950 dark:bg-emerald-950/30 dark:text-emerald-100",
              line.kind === "remove" &&
                "bg-red-50 text-red-950 dark:bg-red-950/30 dark:text-red-100",
              line.kind === "context" &&
                "text-muted-foreground"
            )}
          >
            <span className="text-right opacity-70">
              {line.leftLine ?? ""}
            </span>
            <span className="text-right opacity-70">
              {line.rightLine ?? ""}
            </span>
            <span className="opacity-80">
              {line.kind === "add"
                ? "+"
                : line.kind === "remove"
                  ? "-"
                  : " "}
            </span>
            <span className="whitespace-pre-wrap break-words">{line.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
