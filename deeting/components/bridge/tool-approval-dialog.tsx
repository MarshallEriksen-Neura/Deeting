"use client"

import { useEffect, useState } from "react"
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
  announceBridgeApprovalExecution,
  isBridgeToolApproval,
  useBridgeApprovalStore,
} from "@/lib/chat/bridge-approval-store"
import { invoke } from "@tauri-apps/api/core"
import { bridgeCallTool } from "@/lib/api/bridge"
import { DESKTOP_MCP_COMMANDS } from "@/lib/api/mcp-desktop"
import { toast } from "sonner"
import { Loader2, ShieldAlert, AlertTriangle, Terminal } from "lucide-react"
import { useChatStore } from "@/store/chat-store"
import { extractAssistantTextFromBlocks } from "@/lib/chat/message-blocks"
import {
  createOptimisticApprovalExecutionBlocks,
  createApprovedToolResultBlock,
  findMessageIdForToolCall,
  createLocalChatResumeErrorBlock,
  createRejectedToolResultBlock,
  extractLocalChatApprovalResume,
} from "@/lib/chat/tool-approval"

export function ToolApprovalDialog() {
  const { pending, queue, clear, focusPendingByToken } = useBridgeApprovalStore()
  const messages = useChatStore((state) => state.messages)
  const focusMessage = useChatStore((state) => state.focusMessage)
  const setMessageBlocks = useChatStore((state) => state.setMessageBlocks)
  const upsertMessageToolResult = useChatStore((state) => state.upsertMessageToolResult)
  const appendMessageBlocks = useChatStore((state) => state.appendMessageBlocks)
  const [loadingAction, setLoadingAction] = useState<
    "allow_once" | "allow_always" | "deny_always" | null
  >(null)
  const t = useTranslations("chat.approvalDialog")
  const approvalToken = pending?.approval_token ?? null
  const queueLength = queue.length
  const remainingApprovals = Math.max(0, queueLength - 1)
  const [showAllApprovals, setShowAllApprovals] = useState(false)
  const upcomingApprovals = queue.slice(1, 4)
  const allUpcomingApprovals = queue.slice(1)

  useEffect(() => {
    setLoadingAction(null)
  }, [approvalToken])

  useEffect(() => {
    setShowAllApprovals(false)
  }, [approvalToken])

  if (!pending) return null

  const resolveApprovalMessageId = (approval: typeof pending) => {
    if (approval.meta.message_id) {
      return approval.meta.message_id
    }
    return findMessageIdForToolCall(useChatStore.getState().messages, approval.meta.call_id)
  }

  const formattedArguments = JSON.stringify(pending.arguments, null, 2)

  const approvalSourcePreview = (approval: typeof pending) => {
    const messageId = resolveApprovalMessageId(approval)
    if (!messageId) return t("queueItemSourceFallback")
    const message = messages.find((candidate) => candidate.id === messageId)
    if (!message) return t("queueItemSourceFallback")
    const assistantPreview =
      message.role === "assistant" ? extractAssistantTextFromBlocks(message.blocks).trim() : ""
    const contentPreview = assistantPreview || message.content.trim()
    if (contentPreview) {
      return contentPreview.length > 48
        ? `${contentPreview.slice(0, 47).trimEnd()}...`
        : contentPreview
    }
    return t("queueItemSourceBound")
  }

  const approvalSourceMessageId = (approval: typeof pending) => resolveApprovalMessageId(approval)

  const applyOptimisticExecutionState = (approval: typeof pending) => {
    const messageId = resolveApprovalMessageId(approval)
    if (!messageId) return

    const message = useChatStore
      .getState()
      .messages.find((candidate) => candidate.id === messageId)
    if (!message?.blocks?.length) return

    const nextBlocks = createOptimisticApprovalExecutionBlocks(approval, message.blocks)
    if (nextBlocks !== message.blocks) {
      setMessageBlocks(messageId, nextBlocks)
    }
  }

  const executeApprovedTool = async (
    approval: typeof pending,
    approvalMode: "allow_once" | "allow_always"
  ) => {
    try {
      const result = await invoke(DESKTOP_MCP_COMMANDS.approveTool, {
        approvalToken: approval.approval_token,
        approvalMode,
        callId: approval.meta.call_id,
        executionToken: approval.meta.execution_token,
        executionGraphExecutionId: approval.meta.execution_graph_execution_id,
      })

      const messageId = resolveApprovalMessageId(approval)
      if (messageId) {
        const resumePayload = extractLocalChatApprovalResume(result)
        const approvedToolResult = resumePayload?.approved_tool_result ?? result
        const successBlock = createApprovedToolResultBlock(approval, approvedToolResult)
        if (successBlock) {
          upsertMessageToolResult(messageId, successBlock)
        }
        if (resumePayload?.continuation_blocks?.length) {
          appendMessageBlocks(messageId, resumePayload.continuation_blocks)
        }
        if (resumePayload?.error) {
          appendMessageBlocks(messageId, [
            createLocalChatResumeErrorBlock(approval, resumePayload.error),
          ])
        }
      }

      if (!messageId) {
        toast.success(t("toast.approved", { toolName: approval.tool_name }))
      }

      if (approval.meta.execution_token) {
        try {
          await bridgeCallTool({
            tool_name: approval.tool_name,
            arguments: {
              call_id: approval.meta.call_id,
              result,
              ok: true,
            },
            execution_token: approval.meta.execution_token,
          })
        } catch (err: unknown) {
          console.error("[ApprovalDialog] Bridge callback failed after approval", err)
          const errorMessage = err instanceof Error ? err.message : String(err)
          toast.error(t("toast.executionFailed", { message: errorMessage }))
        }
      }
    } catch (err: unknown) {
      console.error("[ApprovalDialog] Execution failed", err)
      const errorMessage = err instanceof Error ? err.message : String(err)
      toast.error(t("toast.executionFailed", { message: errorMessage }))

      if (isBridgeToolApproval(approval)) {
        const messageId = resolveApprovalMessageId(approval)
        if (messageId) {
          const errorBlock = createRejectedToolResultBlock(approval, errorMessage)
          if (errorBlock) {
            upsertMessageToolResult(messageId, errorBlock)
          }
        }
        if (approval.meta.execution_token) {
          await bridgeCallTool({
            tool_name: approval.tool_name,
            arguments: {
              call_id: approval.meta.call_id,
              result: { error: errorMessage },
              ok: false,
            },
            execution_token: approval.meta.execution_token,
          })
        }
      }
    }
  }

  const handleApprove = (approvalMode: "allow_once" | "allow_always") => {
    const approval = pending
    if (!approval) return

    setLoadingAction(approvalMode)
    applyOptimisticExecutionState(approval)
    announceBridgeApprovalExecution(approval)
    if (resolveApprovalMessageId(approval)) {
      toast.success(
        t(
          approvalMode === "allow_always"
            ? "toast.approvedAlwaysPending"
            : "toast.approvedPending",
          { toolName: approval.tool_name }
        )
      )
    }
    clear()
    void executeApprovedTool(approval, approvalMode)
  }

  const handleRejectAlways = async () => {
    const approval = pending
    if (!approval) return

    try {
      setLoadingAction("deny_always")
      await invoke(DESKTOP_MCP_COMMANDS.rejectTool, {
        approvalToken: approval.approval_token,
        rejectMode: "deny_always",
        executionGraphExecutionId: approval.meta.execution_graph_execution_id,
      })

      const messageId = resolveApprovalMessageId(approval)
      if (messageId) {
        const rejectedBlock = createRejectedToolResultBlock(
          approval,
          t("result.userDeniedAlways")
        )
        if (rejectedBlock) {
          upsertMessageToolResult(messageId, rejectedBlock)
        }
      }

      clear()
      toast.info(t("toast.deniedAlways"))

      if (approval.meta.execution_token) {
        try {
          await bridgeCallTool({
            tool_name: approval.tool_name,
            arguments: {
              call_id: approval.meta.call_id,
              result: { error: t("result.userDeniedAlways") },
              ok: false,
            },
            execution_token: approval.meta.execution_token,
          })
        } catch (err) {
          console.error("[ApprovalDialog] Bridge callback failed after reject", err)
        }
      }
    } catch (err) {
      console.error("[ApprovalDialog] Reject failed", err)
      clear()
    }
  }

  return (
    <AlertDialog open={!!pending}>
      <AlertDialogContent
        className={[
          "max-h-[85vh] max-w-md overflow-hidden",
          // Glass foundation
          "bg-[var(--card)]/60 backdrop-blur-2xl",
          "border border-white/10",
          "rounded-2xl",
          "shadow-[0_8px_32px_-8px_rgba(0,0,0,0.3),0_0_0_1px_rgba(255,255,255,0.05)_inset]",
          // Entry animation
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          "data-[state=open]:slide-in-from-bottom-2",
          "duration-300",
        ].join(" ")}
      >
        {/* Top shine line -- glass highlight */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{
            background:
              "linear-gradient(90deg, transparent, rgba(239,68,68,0.3) 30%, rgba(255,255,255,0.12) 50%, rgba(239,68,68,0.3) 70%, transparent)",
          }}
        />
        {/* Inner border overlay */}
        <div
          className="pointer-events-none absolute inset-0 rounded-2xl"
          style={{
            boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.05)",
          }}
        />

        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2.5 text-base font-semibold text-[var(--foreground)]">
            <div className="flex size-8 items-center justify-center rounded-xl bg-gradient-to-b from-red-500/20 to-red-600/10 text-red-400 ring-1 ring-red-500/20">
              <ShieldAlert className="size-4" />
            </div>
            {t("title")}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="max-h-[60vh] space-y-3.5 overflow-y-auto pr-1 text-sm text-[var(--muted)]">
              <p className="leading-relaxed">{t("description")}</p>
              {queueLength > 1 ? (
                <div className="space-y-2 rounded-lg border border-amber-500/15 bg-amber-500/8 px-3 py-2 text-xs text-[var(--foreground)]/80">
                  <div>{t("queueStatus", { current: 1, total: queueLength })}</div>
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-medium text-[var(--foreground)]/80">
                      {t("queueRemaining", { count: remainingApprovals })}
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-medium text-[var(--foreground)]/80">
                      {t("queueCurrentStatus")}
                    </span>
                  </div>
                  {upcomingApprovals.length > 0 ? (
                    <div className="space-y-1">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]/70">
                        {t("queuePreviewLabel")}
                      </div>
                      <div className="space-y-1">
                        {(showAllApprovals ? allUpcomingApprovals : upcomingApprovals).map((approval) => (
                          <div
                            key={approval.approval_token}
                            className="rounded-md px-2 py-1.5 transition-colors hover:bg-white/5"
                          >
                            <button
                              type="button"
                              onClick={() => focusPendingByToken(approval.approval_token)}
                              className="block w-full text-left"
                            >
                              <div className="truncate font-mono text-[11px] text-[var(--foreground)]/85">
                                {approval.tool_name}
                              </div>
                              {approval.description || approval.risk_level ? (
                                <div className="mt-0.5 truncate text-[10px] text-[var(--muted)]/80">
                                  {approval.risk_level
                                    ? t("queueItemMeta", {
                                        level: approval.risk_level,
                                        summary: approval.description ?? t("queueItemNoSummary"),
                                      })
                                    : approval.description}
                                </div>
                              ) : null}
                            </button>
                            {approvalSourceMessageId(approval) ? (
                              <button
                                type="button"
                                onClick={() => focusMessage(approvalSourceMessageId(approval) ?? null)}
                                className="mt-0.5 truncate text-[10px] text-[var(--muted)]/65 hover:text-[var(--foreground)]/80"
                              >
                                {t("queueItemSource", {
                                  source: approvalSourcePreview(approval),
                                })}
                              </button>
                            ) : (
                              <div className="mt-0.5 truncate text-[10px] text-[var(--muted)]/65">
                                {t("queueItemSource", {
                                  source: approvalSourcePreview(approval),
                                })}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                      {allUpcomingApprovals.length > upcomingApprovals.length ? (
                        <button
                          type="button"
                          onClick={() => setShowAllApprovals((value) => !value)}
                          className="pt-1 text-[11px] font-medium text-amber-300/90 transition-colors hover:text-amber-200"
                        >
                          {showAllApprovals
                            ? t("queuePreviewLess")
                            : t("queuePreviewMore", {
                                count: allUpcomingApprovals.length - upcomingApprovals.length,
                              })}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* Tool info panel -- frosted inner card */}
              <div
                className={[
                  "space-y-3 rounded-xl p-3.5",
                  "bg-[var(--surface)]/40 backdrop-blur-sm",
                  "border border-white/[0.06]",
                  "shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]",
                ].join(" ")}
              >
                {/* Tool name */}
                <div className="space-y-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]/70">
                    {t("toolLabel")}
                  </p>
                  <div className="flex items-center gap-2">
                    <Terminal className="size-3.5 text-[var(--primary)]/70" />
                    <span className="font-mono text-[13px] font-semibold text-[var(--foreground)]">
                      {pending.tool_name}
                    </span>
                  </div>
                </div>

                {/* Separator */}
                <div className="h-px bg-white/[0.06]" />

                {/* Arguments code block */}
                <div className="space-y-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]/70">
                    {t("argumentsLabel")}
                  </p>
                  <div
                    className={[
                      "max-h-[35vh] overflow-y-auto rounded-lg p-3",
                      "bg-[var(--background)]/80",
                      "border border-white/[0.04]",
                      "shadow-[inset_0_2px_4px_rgba(0,0,0,0.15)]",
                      // Scrollbar styling
                      "[&::-webkit-scrollbar]:w-1.5",
                      "[&::-webkit-scrollbar-track]:bg-transparent",
                      "[&::-webkit-scrollbar-thumb]:rounded-full",
                      "[&::-webkit-scrollbar-thumb]:bg-white/10",
                    ].join(" ")}
                  >
                    <pre className="whitespace-pre-wrap break-all font-mono text-xs leading-relaxed text-[var(--muted)]">
                      {formattedArguments}
                    </pre>
                  </div>
                </div>
              </div>

              {/* Description / summary */}
              {pending.description && (
                <div
                  className={[
                    "rounded-xl p-3",
                    "bg-[var(--primary)]/[0.06]",
                    "border border-[var(--primary)]/10",
                  ].join(" ")}
                >
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]/70">
                    {t("summaryLabel")}
                  </p>
                  <p className="mt-1.5 text-xs leading-relaxed italic text-[var(--muted)]">
                    &quot;{pending.description}&quot;
                  </p>
                </div>
              )}

              {pending.recovered ? (
                <div
                  className={[
                    "rounded-xl p-3",
                    "bg-amber-500/[0.08]",
                    "border border-amber-500/15",
                  ].join(" ")}
                >
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]/70">
                    {t("recoveryLabel")}
                  </p>
                  <p className="mt-1.5 text-xs leading-relaxed text-[var(--muted)]">
                    {pending.recovery_reason ?? t("recoveryFallback")}
                  </p>
                  {typeof pending.attempts === "number" ? (
                    <p className="mt-1 text-[11px] text-[var(--muted)]/80">
                      {t("recoveryAttempts", { count: pending.attempts })}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {/* Risk level panel */}
              {!!pending.risk_reasons?.length && (
                <div
                  className={[
                    "space-y-2.5 rounded-xl p-3.5",
                    "bg-red-500/[0.06]",
                    "border border-red-500/15",
                    "shadow-[inset_0_1px_0_rgba(239,68,68,0.06)]",
                  ].join(" ")}
                >
                  <div className="flex items-center gap-2">
                    <div className="flex size-5 items-center justify-center rounded-md bg-red-500/15">
                      <AlertTriangle className="size-3 text-red-400" />
                    </div>
                    <span className="text-xs font-semibold text-red-400">
                      {t("risk.title", { level: pending.risk_level ?? "HIGH" })}
                    </span>
                  </div>
                  <ul className="space-y-1 pl-7 text-xs text-[var(--muted)]">
                    {pending.risk_reasons.map((reason, idx) => (
                      <li
                        key={`${idx}-${reason}`}
                        className="relative before:absolute before:-left-3 before:top-[0.55em] before:size-1 before:rounded-full before:bg-red-400/50"
                      >
                        {reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Warning banner */}
              <div
                className={[
                  "rounded-xl p-3",
                  "bg-amber-500/[0.06]",
                  "border border-amber-500/15",
                  "shadow-[inset_0_1px_0_rgba(245,158,11,0.06)]",
                ].join(" ")}
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-400" />
                  <div>
                    <p className="text-xs font-medium text-amber-300">
                      {t("warningTitle")}
                    </p>
                    <p className="mt-1 text-[11px] leading-relaxed text-amber-400/80">
                      {t("warning")}
                    </p>
                  </div>
                </div>
              </div>

              {(pending.meta.call_id ||
                pending.meta.execution_graph_execution_id ||
                pending.meta.message_id) ? (
                <details className="rounded-xl border border-white/[0.06] bg-[var(--surface)]/30 p-3 text-xs text-[var(--muted)]">
                  <summary className="cursor-pointer list-none font-medium text-[var(--foreground)]/75">
                    {t("debug.title")}
                  </summary>
                  <div className="mt-3 space-y-2 font-mono text-[11px]">
                    {pending.meta.call_id ? (
                      <div className="truncate">
                        {t("debug.callId", { value: pending.meta.call_id })}
                      </div>
                    ) : null}
                    {pending.meta.execution_graph_execution_id ? (
                      <div className="truncate">
                        {t("debug.executionId", {
                          value: pending.meta.execution_graph_execution_id,
                        })}
                      </div>
                    ) : null}
                    {pending.meta.message_id ? (
                      <div className="truncate">
                        {t("debug.messageId", { value: pending.meta.message_id })}
                      </div>
                    ) : null}
                  </div>
                </details>
              ) : null}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter className="gap-2.5 border-t border-white/[0.06] pt-4">
          <AlertDialogCancel
            onClick={handleRejectAlways}
            disabled={loadingAction !== null}
            className={[
              "h-10 rounded-xl px-5",
              "bg-[var(--surface)]/50 backdrop-blur-sm",
              "border border-white/10",
              "text-sm font-medium text-[var(--foreground)]",
              "shadow-[0_2px_8px_-2px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.05)]",
              "hover:bg-[var(--surface)]/70",
              "transition-all duration-200",
              "active:scale-[0.97]",
            ].join(" ")}
          >
            {loadingAction === "deny_always"
              ? t("actions.blocking")
              : t("actions.denyAlways")}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault()
              handleApprove("allow_once")
            }}
            disabled={loadingAction !== null}
            className={[
              "h-10 rounded-xl px-5",
              "bg-gradient-to-b from-red-500 to-red-600",
              "text-sm font-medium text-white",
              "shadow-[0_2px_8px_-2px_rgba(239,68,68,0.4),inset_0_1px_0_rgba(255,255,255,0.15)]",
              "hover:shadow-[0_4px_16px_-2px_rgba(239,68,68,0.5)]",
              "hover:brightness-110",
              "border border-white/10",
              "transition-all duration-200",
              "active:scale-[0.97]",
              "disabled:opacity-40",
            ].join(" ")}
          >
            {loadingAction === "allow_once" ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : null}
            {loadingAction === "allow_once"
              ? t("actions.approving")
              : t("actions.approveOnce")}
          </AlertDialogAction>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault()
              handleApprove("allow_always")
            }}
            disabled={loadingAction !== null}
            className={[
              "h-10 rounded-xl px-5",
              "bg-gradient-to-b from-amber-500 to-amber-600",
              "text-sm font-medium text-white",
              "shadow-[0_2px_8px_-2px_rgba(245,158,11,0.45),inset_0_1px_0_rgba(255,255,255,0.15)]",
              "hover:shadow-[0_4px_16px_-2px_rgba(245,158,11,0.55)]",
              "hover:brightness-110",
              "border border-white/10",
              "transition-all duration-200",
              "active:scale-[0.97]",
              "disabled:opacity-40",
            ].join(" ")}
          >
            {loadingAction === "allow_always" ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : null}
            {loadingAction === "allow_always"
              ? t("actions.approving")
              : t("actions.approveAlways")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
