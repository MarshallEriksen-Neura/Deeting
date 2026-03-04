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
import { useBridgeApprovalStore } from "@/lib/chat/bridge-approval-store"
import { invoke } from "@tauri-apps/api/core"
import { bridgeCallTool } from "@/lib/api/bridge"
import { toast } from "sonner"
import { Loader2, ShieldAlert } from "lucide-react"

export function ToolApprovalDialog() {
  const { pending, clear } = useBridgeApprovalStore()
  const [loading, setLoading] = useState(false)

  if (!pending) return null

  const handleApprove = async () => {
    setLoading(true)
    try {
      // 1. Tell Rust to actually execute the pending tool
      const result = await invoke("approve_mcp_tool", {
        approvalToken: pending.approval_token
      })

      // 2. Send result back to cloud bridge to finish the flow
      await bridgeCallTool({
        tool_name: pending.tool_name,
        arguments: {
          call_id: pending.meta.call_id,
          result,
          ok: true
        },
        execution_token: pending.meta.execution_token
      })

      toast.success(`Tool ${pending.tool_name} executed successfully`)
      clear()
    } catch (err: any) {
      console.error("[ApprovalDialog] Execution failed", err)
      toast.error(`Execution failed: ${err.toString()}`)
      
      // Still need to report failure to cloud so it doesn't hang
      await bridgeCallTool({
        tool_name: pending.tool_name,
        arguments: {
          call_id: pending.meta.call_id,
          result: { error: err.toString() },
          ok: false
        },
        execution_token: pending.meta.execution_token
      })
      clear()
    } finally {
      setLoading(false)
    }
  }

  const handleReject = async () => {
    try {
      await invoke("reject_mcp_tool", {
        approvalToken: pending.approval_token
      })
      
      // Report cancellation to cloud
      await bridgeCallTool({
        tool_name: pending.tool_name,
        arguments: {
          call_id: pending.meta.call_id,
          result: { error: "User rejected tool execution" },
          ok: false
        },
        execution_token: pending.meta.execution_token
      })
      
      toast.info("Tool execution cancelled by user")
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
            Security Confirmation
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-3">
            <p>
              AI is requesting to execute a <span className="font-bold text-foreground">high-risk tool</span> on your local system:
            </p>
            <div className="rounded-md bg-muted p-3 text-xs font-mono break-all">
              <div className="mb-1 text-primary font-bold">{pending.tool_name}</div>
              <div className="text-muted-foreground">
                {JSON.stringify(pending.arguments, null, 2)}
              </div>
            </div>
            {pending.description && (
              <p className="text-xs italic text-muted-foreground">
                "{pending.description}"
              </p>
            )}
            <p className="text-xs text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-950/30 p-2 rounded border border-yellow-200 dark:border-yellow-900">
              Warning: This tool may modify files or execute system commands. Only allow if you trust the current AI conversation.
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
