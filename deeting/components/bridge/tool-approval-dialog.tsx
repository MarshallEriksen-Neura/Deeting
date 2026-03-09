"use client"

import { useState } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  isBridgeToolApproval,
  useBridgeApprovalStore,
} from "@/lib/chat/bridge-approval-store"
import type { MessageBlock } from "@/lib/chat/message-protocol"
import { useChatStore } from "@/store/chat-store"
import { invoke } from "@tauri-apps/api/core"
import { bridgeCallTool } from "@/lib/api/bridge"
import { toast } from "sonner"
import { Loader2, ShieldAlert } from "lucide-react"

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null
  return value as Record<string, unknown>
}

function isMessageBlock(value: unknown): value is MessageBlock {
  return Boolean(value && typeof value === "object" && "type" in (value as Record<string, unknown>))
}

function extractAssistantResponseBlocks(responseBody: Record<string, unknown>): MessageBlock[] {
  const choices = Array.isArray(responseBody.choices) ? responseBody.choices : []
  const firstChoice = choices[0]
  const responseMessage = firstChoice && typeof firstChoice === "object"
    ? (firstChoice as Record<string, unknown>).message
    : null
  if (!responseMessage || typeof responseMessage !== "object") {
    return []
  }

  const messageObject = responseMessage as Record<string, unknown>
  const metaInfo = toRecord(messageObject.meta_info)
  const metaBlocks = Array.isArray(metaInfo?.blocks)
    ? (metaInfo.blocks.filter(isMessageBlock) as MessageBlock[])
    : []

  const nextBlocks = metaBlocks.filter(
    (block) => block.type !== "tool_call" && block.type !== "tool_result"
  )
  if (nextBlocks.length > 0) {
    return nextBlocks
  }

  const textContent = typeof messageObject.content === "string" ? messageObject.content : ""
  return textContent.trim() ? [{ type: "text", content: textContent } as MessageBlock] : []
}

export function ToolApprovalDialog() {
  const { pending, clear } = useBridgeApprovalStore()
  const [loading, setLoading] = useState(false)

  if (!pending) return null

  const dialogCopy =
    pending.kind === "local_code_mode"
      ? {
          title: "Approve Local Code Execution",
          intro:
            "AI is requesting approval to continue a local code-mode execution on this device:",
          successMessage: `Code-mode execution ${pending.tool_name} approved`,
          rejectMessage: "Code-mode execution cancelled by user",
          warning:
            "Warning: This action may read or modify local files, run commands, or continue a paused code-mode task.",
        }
      : {
          title: "Security Confirmation",
          intro:
            "AI is requesting to execute a high-risk tool on your local system:",
          successMessage: `Tool ${pending.tool_name} executed successfully`,
          rejectMessage: "Tool execution cancelled by user",
          warning:
            "Warning: This tool may modify files or execute system commands. Only allow if you trust the current AI conversation.",
        }

  const handleApprove = async () => {
    setLoading(true)
    try {
      if (isBridgeToolApproval(pending)) {
        const result = await invoke("approve_mcp_tool", {
          approvalToken: pending.approval_token,
          callId: pending.meta.call_id,
          executionToken: pending.meta.execution_token,
        })

        await bridgeCallTool({
          tool_name: pending.tool_name,
          arguments: {
            call_id: pending.meta.call_id,
            result,
            ok: true,
          },
          execution_token: pending.meta.execution_token,
        })
      } else {
        const result = await invoke(pending.meta.approve_action.command, {
          approvalToken: pending.approval_token,
          ...(pending.meta.approve_action.args ?? {}),
        })
        const payload = toRecord(result)
        const streamedBlocks = Array.isArray(payload?.blocks)
          ? (payload?.blocks.filter(isMessageBlock) as MessageBlock[])
          : []
        if (streamedBlocks.length > 0) {
          useChatStore
            .getState()
            .appendMessageBlocks(pending.meta.assistant_message_id, streamedBlocks)
        }
        const response = toRecord(payload?.response)
        if (response) {
          const responseBlocks = extractAssistantResponseBlocks(response)
          if (responseBlocks.length > 0) {
            useChatStore
              .getState()
              .appendMessageBlocks(pending.meta.assistant_message_id, responseBlocks)
          }
          const traceId =
            typeof response.trace_id === "string"
              ? response.trace_id
              : typeof payload?.trace_id === "string"
                ? payload.trace_id
                : null
          if (traceId) {
            useChatStore
              .getState()
              .mergeMessageMeta(pending.meta.assistant_message_id, { trace_id: traceId })
          }
        }
      }

      toast.success(dialogCopy.successMessage)
      clear()
    } catch (err: unknown) {
      console.error("[ApprovalDialog] Execution failed", err)
      const errorMessage = err instanceof Error ? err.message : String(err)
      toast.error(`Execution failed: ${errorMessage}`)

      if (isBridgeToolApproval(pending)) {
        await bridgeCallTool({
          tool_name: pending.tool_name,
          arguments: {
            call_id: pending.meta.call_id,
            result: { error: errorMessage },
            ok: false,
          },
          execution_token: pending.meta.execution_token,
        })
      }
      clear()
    } finally {
      setLoading(false)
    }
  }

  const handleReject = async () => {
    try {
      if (isBridgeToolApproval(pending)) {
        await invoke("reject_mcp_tool", {
          approvalToken: pending.approval_token,
        })

        await bridgeCallTool({
          tool_name: pending.tool_name,
          arguments: {
            call_id: pending.meta.call_id,
            result: { error: "User rejected tool execution" },
            ok: false,
          },
          execution_token: pending.meta.execution_token,
        })
      } else if (pending.meta.reject_action) {
        await invoke(pending.meta.reject_action.command, {
          approvalToken: pending.approval_token,
          ...(pending.meta.reject_action.args ?? {}),
        })
        useChatStore.getState().appendMessageBlocks(pending.meta.assistant_message_id, [{
          id: `${pending.meta.call_id || pending.approval_token}-tool-result-rejected`,
          type: "tool_result",
          callId: pending.meta.call_id || undefined,
          toolName: pending.tool_name,
          status: "error",
          result: { error: "User rejected tool execution" },
        } as MessageBlock])
      }

      toast.info(dialogCopy.rejectMessage)
    } catch (err) {
      console.error("[ApprovalDialog] Reject failed", err)
    } finally {
      clear()
    }
  }

  return (
    <AlertDialog open={!!pending}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <ShieldAlert className="h-5 w-5" />
            {dialogCopy.title}
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-3">
            <p>
              {dialogCopy.intro}
            </p>
            <div className="rounded-md bg-muted p-3 text-xs font-mono break-all">
              <div className="mb-1 text-primary font-bold">{pending.tool_name}</div>
              <div className="text-muted-foreground">
                {JSON.stringify(pending.arguments, null, 2)}
              </div>
            </div>
            {pending.description && (
              <p className="text-xs italic text-muted-foreground">
                &quot;{pending.description}&quot;
              </p>
            )}
            {!!pending.risk_reasons?.length && (
              <div className="rounded border border-destructive/40 bg-destructive/5 p-2 text-xs">
                <div className="mb-1 font-semibold text-destructive">
                  Risk {pending.risk_level ?? "HIGH"}
                </div>
                <ul className="list-disc pl-4 space-y-1 text-muted-foreground">
                  {pending.risk_reasons.map((reason, idx) => (
                    <li key={`${idx}-${reason}`}>{reason}</li>
                  ))}
                </ul>
              </div>
            )}
            <p className="rounded border border-yellow-200 bg-yellow-50 p-2 text-xs text-yellow-600 dark:border-yellow-900 dark:bg-yellow-950/30 dark:text-yellow-400">
              {dialogCopy.warning}
            </p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleReject} disabled={loading}>
            Deny
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault()
              handleApprove()
            }}
            disabled={loading}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Allow Execution
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
