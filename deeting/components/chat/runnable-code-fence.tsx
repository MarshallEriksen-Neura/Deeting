"use client"

import { useMemo, useState } from "react"
import { Loader2, Play } from "lucide-react"

import { CodeBlock } from "@/components/chat/code-block"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/hooks/use-i18n"
import {
  runLocalSandboxCodeSnippet,
  type SandboxSnippetLanguage,
} from "@/lib/api/sandbox"
import { isTauriRuntime } from "@/lib/runtime/tauri"
import { useChatStore } from "@/store/chat-store"

const TOOL_NAME = "run_local_code_snippet"
const DEFAULT_EXECUTION_TIMEOUT_SECS = 30

const RUNNABLE_LANGUAGE_ALIASES: Record<string, SandboxSnippetLanguage> = {
  python: "python",
  py: "python",
  go: "go",
  golang: "go",
  rust: "rust",
  rs: "rust",
  java: "java",
}

export function normalizeRunnableFenceLanguage(
  language?: string
): SandboxSnippetLanguage | null {
  const normalized = language?.trim().toLowerCase()
  if (!normalized) return null
  return RUNNABLE_LANGUAGE_ALIASES[normalized] ?? null
}

export function supportsRunnableFence(language: string | undefined, source: string): boolean {
  return !!normalizeRunnableFenceLanguage(language) && source.trim().length > 0
}

export const buildRunnableFenceCallId = (messageId: string, fenceId: string) =>
  `${TOOL_NAME}:${messageId}:${fenceId}`

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
  const upsertMessageToolResult = useChatStore((state) => state.upsertMessageToolResult)
  const [isRunning, setIsRunning] = useState(false)

  const runnableLanguage = useMemo(
    () => normalizeRunnableFenceLanguage(language),
    [language]
  )
  const callId = useMemo(
    () => buildRunnableFenceCallId(messageId, fenceId),
    [fenceId, messageId]
  )
  const canRun =
    !!sessionId && !!runnableLanguage && isTauriRuntime() && source.trim().length > 0

  const handleRun = async () => {
    if (!canRun || !sessionId || !runnableLanguage || isRunning) return

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
        code: source,
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

  return (
    <CodeBlock
      className={className}
      language={language}
      headerActions={
        canRun ? (
          <Button
            variant="secondary"
            size="sm"
            className="h-6 gap-1 px-2 text-[10px] font-medium"
            disabled={isRunning}
            onClick={() => void handleRun()}
          >
            {isRunning ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Play className="h-3 w-3" />
            )}
            {isRunning ? t("codeBlock.running") : t("codeBlock.run")}
          </Button>
        ) : null
      }
    >
      {source}
    </CodeBlock>
  )
}
