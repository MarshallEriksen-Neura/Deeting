"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Eraser,
  Loader2,
  Play,
  RotateCcw,
  Terminal,
} from "lucide-react"

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

type ResultTone = "success" | "danger" | "neutral"

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
  const [activeResultTab, setActiveResultTab] = useState<
    "stdout" | "stderr" | "result" | "diff"
  >("stdout")
  const [runHistory, setRunHistory] = useState<RunHistoryItem[]>([])
  const [selectedHistoryKey, setSelectedHistoryKey] = useState<string | null>(null)
  const [outputCleared, setOutputCleared] = useState(false)
  const [copied, setCopied] = useState(false)
  const [gutterScrollTop, setGutterScrollTop] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
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

  const resultKey = useMemo(() => {
    if (!toolResult) return null
    let payloadFingerprint = "empty"
    try {
      payloadFingerprint = JSON.stringify(toolResult.result ?? null)
    } catch {
      payloadFingerprint = String(toolResult.result ?? "empty")
    }
    return `${toolResult.id}:${toolResult.status ?? "unknown"}:${payloadFingerprint}`
  }, [toolResult])

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
    const aggregate = [stdoutText, stderrText, resultText]
      .filter(Boolean)
      .join("\n")
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
    if (
      toolResult?.status === "error" ||
      (visibleResult && !visibleResult.success)
    ) {
      return "error"
    }
    if (toolResult?.status === "success" || visibleResult?.success)
      return "success"
    return "idle"
  }, [isRunning, toolCall?.status, toolResult?.status, visibleResult])

  const stateLabel =
    visualState === "running"
      ? "Running"
      : visualState === "success"
        ? "Ready"
        : visualState === "error"
          ? "Failed"
          : "Editable"

  const comparisonTarget = useMemo(() => {
    if (visibleHistory) {
      const currentIndex = runHistory.findIndex(
        (item) => item.key === visibleHistory.key
      )
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
        error instanceof Error
          ? error.message
          : "Local code snippet execution failed"
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

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(editableSource)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      // ignore — clipboard unavailable
    }
  }

  const handleEditorKeyDown = (
    event: React.KeyboardEvent<HTMLTextAreaElement>
  ) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault()
      void handleRun()
      return
    }
    if (event.key === "Tab") {
      event.preventDefault()
      const target = event.currentTarget
      const selectionStart = target.selectionStart ?? 0
      const selectionEnd = target.selectionEnd ?? selectionStart
      const next =
        editableSource.slice(0, selectionStart) +
        "  " +
        editableSource.slice(selectionEnd)
      setEditableSource(next)
      requestAnimationFrame(() => {
        const pos = selectionStart + 2
        textareaRef.current?.setSelectionRange(pos, pos)
      })
    }
  }

  const languageLabel =
    runnableLanguage?.toUpperCase() ?? language?.toUpperCase() ?? "CODE"

  const StatusIcon =
    visualState === "running"
      ? Loader2
      : visualState === "success"
        ? CheckCircle2
        : visualState === "error"
          ? AlertTriangle
          : Terminal

  return (
    <div className={cn("atelier-shell", className)}>
      <span className="atelier-corner" data-pos="tl" aria-hidden />
      <span className="atelier-corner" data-pos="tr" aria-hidden />
      <span className="atelier-corner" data-pos="bl" aria-hidden />
      <span className="atelier-corner" data-pos="br" aria-hidden />

      {/* Header */}
      <header className="atelier-header">
        <div className="atelier-header-left">
          <span className="atelier-chip" data-tone="accent">
            {languageLabel}
          </span>
          <span className="atelier-chip" data-tone="plain">
            Local sandbox
          </span>
          {visibleResult?.image ? (
            <span className="atelier-chip" data-tone="plain">
              {visibleResult.image}
            </span>
          ) : null}
        </div>

        <div className="atelier-header-right">
          {isDirty ? (
            <button
              type="button"
              className="atelier-ghost-btn"
              onClick={handleReset}
              aria-label="Reset to original"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </button>
          ) : null}

          <span
            className="atelier-state"
            data-state={visualState}
            aria-live="polite"
          >
            <span className="atelier-state-dot" aria-hidden />
            {stateLabel}
          </span>

          {canRun ? (
            <button
              type="button"
              className="atelier-run-btn"
              data-running={isRunning ? "true" : "false"}
              disabled={isRunning}
              onClick={() => void handleRun()}
              aria-label={isRunning ? t("codeBlock.running") : t("codeBlock.run")}
            >
              <span className="atelier-run-icon">
                {isRunning ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5 fill-current" />
                )}
              </span>
              <span>
                {isRunning ? t("codeBlock.running") : t("codeBlock.run")}
              </span>
              <span className="atelier-kbd" aria-hidden>
                ⌘⏎
              </span>
            </button>
          ) : null}
        </div>
      </header>

      {/* Split body */}
      <div className="atelier-split">
        {/* Editor pane */}
        <section className="atelier-pane atelier-editor">
          <div className="atelier-editor-sub">
            <div className="atelier-crumb">
              <span className="atelier-crumb-dot" aria-hidden />
              <span className="atelier-crumb-title">
                buffer.{runnableLanguage ?? "txt"}
              </span>
              <span>· {lineCount} ln</span>
            </div>
            <div className="flex items-center gap-2">
              <span>{isDirty ? "modified" : "synced"}</span>
              <button
                type="button"
                className="atelier-ghost-btn"
                onClick={() => void handleCopy()}
                aria-label="Copy source"
              >
                {copied ? (
                  <CheckCircle2 className="h-3 w-3" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>

          <div className="atelier-editor-body">
            <div
              className="atelier-gutter"
              data-dirty={isDirty ? "true" : "false"}
              aria-hidden
            >
              <div
                className="atelier-gutter-track"
                style={{ transform: `translateY(-${gutterScrollTop}px)` }}
              >
                {Array.from({ length: lineCount }).map((_, index) => (
                  <div key={`ln-${index + 1}`}>{index + 1}</div>
                ))}
              </div>
            </div>
            <textarea
              ref={textareaRef}
              className="atelier-textarea"
              value={editableSource}
              onChange={(event) => setEditableSource(event.target.value)}
              onKeyDown={handleEditorKeyDown}
              onScroll={(event) =>
                setGutterScrollTop(event.currentTarget.scrollTop)
              }
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              wrap="off"
              rows={Math.min(Math.max(lineCount, 6), 24)}
              aria-label="runnable-code-editor"
            />
          </div>

          <div className="atelier-editor-footer">
            <span>
              {languageLabel} · {editableSource.length} chars
            </span>
            <span className="atelier-editor-footer-keys">
              <span className="atelier-keycap">Tab</span>
              <span>indent</span>
              <span>·</span>
              <span className="atelier-keycap">⌘</span>
              <span className="atelier-keycap">⏎</span>
              <span>run</span>
            </span>
          </div>
        </section>

        {/* Result pane */}
        <section className="atelier-pane atelier-result">
          <div className="atelier-result-head">
            <div className="atelier-result-title">
              <span className="atelier-status-icon" data-state={visualState}>
                <StatusIcon
                  className={cn(
                    "h-4 w-4",
                    visualState === "running" && "animate-spin"
                  )}
                />
              </span>
              <div>
                <div className="text-sm font-semibold text-[color:var(--atl-ink)]">
                  Result
                </div>
                <div className="text-[11px] text-[color:var(--atl-ink-soft)]">
                  {visibleResult?.runtime_mode
                    ? `runtime · ${visibleResult.runtime_mode}`
                    : "Run the snippet to surface sandbox output"}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {visibleHistory ? (
                <button
                  type="button"
                  className="atelier-ghost-btn"
                  onClick={handleClearOutput}
                  aria-label="Clear output"
                >
                  <Eraser className="h-3 w-3" />
                  Clear
                </button>
              ) : null}
            </div>
          </div>

          {(visibleResult?.status ||
            (visibleResult?.exit_code !== undefined &&
              visibleResult?.exit_code !== null) ||
            outputLineCount > 0 ||
            visibleResult?.sandbox_id) ? (
            <div className="atelier-result-meta">
              {visibleResult?.status ? (
                <>
                  <span>{visibleResult.status}</span>
                </>
              ) : null}
              {visibleResult?.exit_code !== undefined &&
              visibleResult?.exit_code !== null ? (
                <>
                  <span className="atelier-result-meta-sep" aria-hidden />
                  <span>exit · {visibleResult.exit_code}</span>
                </>
              ) : null}
              {outputLineCount > 0 ? (
                <>
                  <span className="atelier-result-meta-sep" aria-hidden />
                  <span>{outputLineCount} ln</span>
                </>
              ) : null}
              {visibleResult?.sandbox_id ? (
                <>
                  <span className="atelier-result-meta-sep" aria-hidden />
                  <span>box · {visibleResult.sandbox_id}</span>
                </>
              ) : null}
            </div>
          ) : null}

          <div className="atelier-pane-body">
            {runHistory.length > 0 ? (
              <div>
                <div className="atelier-history-label">
                  <span>Recent runs</span>
                  <span className="atelier-result-meta-sep" aria-hidden />
                  <span>{runHistory.length}</span>
                </div>
                <div className="atelier-history">
                  {runHistory.map((item, index) => {
                    const isSelected =
                      visibleHistory?.key === item.key && !outputCleared
                    return (
                      <button
                        key={item.key}
                        type="button"
                        className="atelier-history-card"
                        data-active={isSelected ? "true" : "false"}
                        onClick={() => {
                          setSelectedHistoryKey(item.key)
                          setOutputCleared(false)
                        }}
                        aria-label={`Run ${item.runNumber}`}
                      >
                        <div className="atelier-history-card-head">
                          <span className="atelier-history-card-title">
                            Run {String(item.runNumber).padStart(2, "0")}
                          </span>
                          {index === 0 ? (
                            <span className="atelier-history-card-badge">
                              Latest
                            </span>
                          ) : null}
                        </div>
                        <div className="atelier-history-card-time">
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
                <button
                  type="button"
                  className="atelier-ghost-btn"
                  onClick={handleLoadSelected}
                  aria-label="Load into editor"
                >
                  Load into editor
                </button>
                <button
                  type="button"
                  className="atelier-ghost-btn"
                  onClick={() => void handleRunSelected()}
                  disabled={isRunning}
                  aria-label="Run selected"
                >
                  <Play className="h-3 w-3" />
                  Run selected
                </button>
              </div>
            ) : null}

            {!visibleHistory && visualState === "idle" ? (
              <div className="atelier-empty">
                Edit the buffer on the left, then hit{" "}
                <span className="atelier-keycap">⌘</span>{" "}
                <span className="atelier-keycap">⏎</span>. Each run is pinned
                here alongside stdout, stderr and a diff — no result card will
                drop into the thread below.
              </div>
            ) : null}

            {!visibleHistory && outputCleared ? (
              <div className="atelier-empty">
                Output cleared. Select a pinned run above to bring it back, or
                run the snippet again.
              </div>
            ) : null}

            {visibleResult?.error ? (
              <div className="atelier-callout" data-tone="error">
                <div className="atelier-callout-title">
                  {visibleResult.error}
                </div>
                {visibleResult.error_code ? (
                  <div className="atelier-callout-code">
                    {visibleResult.error_code}
                  </div>
                ) : null}
              </div>
            ) : null}

            {visibleHistory ? (
              <>
                <div className="atelier-seg" role="tablist">
                  <button
                    type="button"
                    role="tab"
                    className="atelier-seg-item"
                    data-active={activeResultTab === "stdout"}
                    onClick={() => setActiveResultTab("stdout")}
                  >
                    stdout
                    {stdoutText ? (
                      <span className="atelier-seg-badge" data-tone="success">
                        live
                      </span>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    className="atelier-seg-item"
                    data-active={activeResultTab === "stderr"}
                    onClick={() => setActiveResultTab("stderr")}
                  >
                    stderr
                    {stderrText ? (
                      <span className="atelier-seg-badge" data-tone="danger">
                        !
                      </span>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    className="atelier-seg-item"
                    data-active={activeResultTab === "result"}
                    onClick={() => setActiveResultTab("result")}
                  >
                    result
                    {resultText && resultText !== stdoutText ? (
                      <span className="atelier-seg-badge">val</span>
                    ) : null}
                  </button>
                  {comparisonTarget ? (
                    <button
                      type="button"
                      role="tab"
                      className="atelier-seg-item"
                      data-active={activeResultTab === "diff"}
                      onClick={() => setActiveResultTab("diff")}
                    >
                      diff
                    </button>
                  ) : null}
                </div>

                <div hidden={activeResultTab !== "stdout"}>
                  <StreamPane
                    title="stdout"
                    tone="success"
                    content={stdoutText}
                    fallback="No stdout captured."
                  />
                </div>
                <div hidden={activeResultTab !== "stderr"}>
                  <StreamPane
                    title="stderr"
                    tone="danger"
                    content={stderrText}
                    fallback="No stderr."
                  />
                </div>
                <div hidden={activeResultTab !== "result"}>
                  <StreamPane
                    title="result"
                    tone="neutral"
                    content={
                      resultText && resultText !== stdoutText ? resultText : ""
                    }
                    fallback="No structured result payload."
                  />
                </div>
                {comparisonTarget ? (
                  <div hidden={activeResultTab !== "diff"}>
                    <DiffPane
                      currentLabel={`Run ${visibleHistory.runNumber}`}
                      previousLabel={comparisonTarget.label}
                      lines={diffLines}
                    />
                  </div>
                ) : null}
              </>
            ) : null}

            {!stdoutText &&
            !stderrText &&
            !resultText &&
            visualState === "running" ? (
              <div className="atelier-callout" data-tone="sky">
                Sandbox is executing this snippet — results will stream in here
                when the run settles.
              </div>
            ) : null}

            {nextActions.length > 0 ? (
              <div className="atelier-callout" data-tone="amber">
                <div
                  className="atelier-callout-title"
                  style={{ marginBottom: 6 }}
                >
                  Next actions
                </div>
                <ul
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    margin: 0,
                    padding: 0,
                    listStyle: "none",
                  }}
                >
                  {nextActions.map((action, index) => (
                    <li key={`${callId}-next-${index}`}>{action}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  )
}

function StreamPane({
  title,
  tone,
  content,
  fallback,
}: {
  title: string
  tone: ResultTone
  content: string
  fallback: string
}) {
  const isEmpty = !content.trim()
  return (
    <div className="atelier-stream" data-tone={tone}>
      <div className="atelier-stream-title">
        <span>{title}</span>
        {isEmpty ? null : <span className="atelier-result-meta-sep" />}
        {isEmpty ? null : (
          <span style={{ opacity: 0.7 }}>{content.split("\n").length} ln</span>
        )}
      </div>
      <pre className="atelier-stream-body" data-muted={isEmpty ? "true" : "false"}>
        {isEmpty ? fallback : content}
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
    <div data-testid="runnable-diff-pane" className="atelier-diff">
      <div className="atelier-diff-head">
        <span>{currentLabel}</span>
        <span className="atelier-result-meta-sep" aria-hidden />
        <span>vs</span>
        <span className="atelier-result-meta-sep" aria-hidden />
        <span>{previousLabel}</span>
      </div>
      {lines.map((line, index) => (
        <div
          key={`${line.kind}-${index}-${line.leftLine}-${line.rightLine}`}
          className="atelier-diff-row"
          data-kind={line.kind}
        >
          <span className="atelier-diff-num">{line.leftLine ?? ""}</span>
          <span className="atelier-diff-num">{line.rightLine ?? ""}</span>
          <span className="atelier-diff-sign" data-kind={line.kind}>
            {line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " "}
          </span>
          <span className="atelier-diff-text">{line.text}</span>
        </div>
      ))}
    </div>
  )
}
