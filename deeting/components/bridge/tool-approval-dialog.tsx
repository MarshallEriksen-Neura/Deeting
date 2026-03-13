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
import { invoke } from "@tauri-apps/api/core"
import { bridgeCallTool } from "@/lib/api/bridge"
import { toast } from "sonner"
import { Loader2, ShieldAlert } from "lucide-react"
import { useChatStore } from "@/store/chat-store"
import {
  createApprovedToolResultBlock,
  createRejectedToolResultBlock,
} from "@/lib/chat/tool-approval"

export function ToolApprovalDialog() {
  const { pending, clear } = useBridgeApprovalStore()
  const upsertMessageToolResult = useChatStore((state) => state.upsertMessageToolResult)
  const [loading, setLoading] = useState(false)

  if (!pending) return null

  const dialogCopy = {
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
      const result = await invoke("approve_mcp_tool", {
        approvalToken: pending.approval_token,
        callId: pending.meta.call_id,
        executionToken: pending.meta.execution_token,
      })

      if (pending.meta.message_id) {
        const successBlock = createApprovedToolResultBlock(pending, result)
        if (successBlock) {
          upsertMessageToolResult(pending.meta.message_id, successBlock)
        }
      }

      if (pending.meta.execution_token) {
        await bridgeCallTool({
          tool_name: pending.tool_name,
          arguments: {
            call_id: pending.meta.call_id,
            result,
            ok: true,
          },
          execution_token: pending.meta.execution_token,
        })
      }

      toast.success(dialogCopy.successMessage)
      clear()
    } catch (err: unknown) {
      console.error("[ApprovalDialog] Execution failed", err)
      const errorMessage = err instanceof Error ? err.message : String(err)
      toast.error(`Execution failed: ${errorMessage}`)

      if (isBridgeToolApproval(pending)) {
        if (pending.meta.message_id) {
          const errorBlock = createRejectedToolResultBlock(pending, errorMessage)
          if (errorBlock) {
            upsertMessageToolResult(pending.meta.message_id, errorBlock)
          }
        }
        if (pending.meta.execution_token) {
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
      }
      clear()
    } finally {
      setLoading(false)
    }
  }

  const handleReject = async () => {
    try {
      await invoke("reject_mcp_tool", {
        approvalToken: pending.approval_token,
      })

      if (pending.meta.message_id) {
        const rejectedBlock = createRejectedToolResultBlock(pending)
        if (rejectedBlock) {
          upsertMessageToolResult(pending.meta.message_id, rejectedBlock)
        }
      }

      if (pending.meta.execution_token) {
        await bridgeCallTool({
          tool_name: pending.tool_name,
          arguments: {
            call_id: pending.meta.call_id,
            result: { error: "User rejected tool execution" },
            ok: false,
          },
          execution_token: pending.meta.execution_token,
        })
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
      <AlertDialogContent className="max-h-[85vh] max-w-md overflow-hidden">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <ShieldAlert className="h-5 w-5" />
            {dialogCopy.title}
          </AlertDialogTitle>
          <AlertDialogDescription className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
            <p>
              {dialogCopy.intro}
            </p>
            <div className="max-h-[40vh] overflow-y-auto rounded-md bg-muted p-3 text-xs font-mono">
              <div className="mb-1 text-primary font-bold">{pending.tool_name}</div>
              <pre className="whitespace-pre-wrap break-all text-muted-foreground">
                {JSON.stringify(pending.arguments, null, 2)}
              </pre>
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
