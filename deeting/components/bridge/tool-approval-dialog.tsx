"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
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
  createLocalChatResumeErrorBlock,
  createRejectedToolResultBlock,
  extractLocalChatApprovalResume,
} from "@/lib/chat/tool-approval"

export function ToolApprovalDialog() {
  const { pending, clear } = useBridgeApprovalStore()
  const upsertMessageToolResult = useChatStore((state) => state.upsertMessageToolResult)
  const appendMessageBlocks = useChatStore((state) => state.appendMessageBlocks)
  const [loading, setLoading] = useState(false)
  const t = useTranslations("chat.approvalDialog")

  if (!pending) return null

  const rejectedErrorMessage = t("result.userRejected")
  const formattedArguments = JSON.stringify(pending.arguments, null, 2)

  const handleApprove = async () => {
    setLoading(true)
    try {
      const result = await invoke("approve_mcp_tool", {
        approvalToken: pending.approval_token,
        callId: pending.meta.call_id,
        executionToken: pending.meta.execution_token,
      })

      if (pending.meta.message_id) {
        const resumePayload = extractLocalChatApprovalResume(result)
        const approvedToolResult = resumePayload?.approved_tool_result ?? result
        const successBlock = createApprovedToolResultBlock(pending, approvedToolResult)
        if (successBlock) {
          upsertMessageToolResult(pending.meta.message_id, successBlock)
        }
        if (resumePayload?.continuation_blocks?.length) {
          appendMessageBlocks(pending.meta.message_id, resumePayload.continuation_blocks)
        }
        if (resumePayload?.error) {
          appendMessageBlocks(pending.meta.message_id, [
            createLocalChatResumeErrorBlock(pending, resumePayload.error),
          ])
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

      toast.success(t("toast.approved", { toolName: pending.tool_name }))
      clear()
    } catch (err: unknown) {
      console.error("[ApprovalDialog] Execution failed", err)
      const errorMessage = err instanceof Error ? err.message : String(err)
      toast.error(t("toast.executionFailed", { message: errorMessage }))

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
        const rejectedBlock = createRejectedToolResultBlock(pending, rejectedErrorMessage)
        if (rejectedBlock) {
          upsertMessageToolResult(pending.meta.message_id, rejectedBlock)
        }
      }

      if (pending.meta.execution_token) {
        await bridgeCallTool({
          tool_name: pending.tool_name,
          arguments: {
            call_id: pending.meta.call_id,
            result: { error: rejectedErrorMessage },
            ok: false,
          },
          execution_token: pending.meta.execution_token,
        })
      }

      toast.info(t("toast.rejected"))
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
            {t("title")}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1 text-sm text-muted-foreground">
              <p>{t("description")}</p>

              <div className="space-y-2 rounded-lg border bg-muted/50 p-3">
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-foreground/80">
                    {t("toolLabel")}
                  </p>
                  <div className="font-mono text-xs font-semibold text-foreground">
                    {pending.tool_name}
                  </div>
                </div>

                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-foreground/80">
                    {t("argumentsLabel")}
                  </p>
                  <div className="max-h-[40vh] overflow-y-auto rounded-md bg-background p-3 text-xs font-mono">
                    <pre className="whitespace-pre-wrap break-all text-muted-foreground">
                      {formattedArguments}
                    </pre>
                  </div>
                </div>
              </div>

              {pending.description && (
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-foreground/80">
                    {t("summaryLabel")}
                  </p>
                  <p className="text-xs italic text-muted-foreground">
                    &quot;{pending.description}&quot;
                  </p>
                </div>
              )}

              {!!pending.risk_reasons?.length && (
                <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs">
                  <div className="font-semibold text-destructive">
                    {t("risk.title", { level: pending.risk_level ?? "HIGH" })}
                  </div>
                  <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
                    {pending.risk_reasons.map((reason, idx) => (
                      <li key={`${idx}-${reason}`}>{reason}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-xs dark:border-yellow-900 dark:bg-yellow-950/30">
                <p className="font-medium text-yellow-800 dark:text-yellow-300">
                  {t("warningTitle")}
                </p>
                <p className="mt-1 text-yellow-700 dark:text-yellow-400">
                  {t("warning")}
                </p>
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleReject} disabled={loading}>
            {t("actions.reject")}
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
            {loading ? t("actions.approving") : t("actions.approve")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
