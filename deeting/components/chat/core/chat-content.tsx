"use client"
import * as React from "react"
import { ChatMessageList } from "../messages"
import { useChatStore, type ChatAssistant } from "@/store/chat-store"
import { useChatRuntimeStore } from "@/store/chat-runtime-store"
import { useChatMessagingService } from "@/hooks/chat/use-chat-messaging-service"
import { useHydratePendingToolApproval } from "@/hooks/chat/use-hydrate-pending-tool-approval"
import { useBrowserModeToolActivity } from "@/hooks/chat/use-browser-mode-tool-activity"
import { useWorkflowStore } from "@/store/workflow-store"
import { getWorkflowRunStatus } from "@/lib/workflow/commands"
import {
  buildWorkflowReceiptBlocks,
  buildWorkflowLiveBlocks,
  buildWorkflowPlanBlocks,
  isWorkflowTerminal,
} from "@/lib/workflow/presentation"
import type { Message } from "@/store/chat-store"
import type { ChatFeedbackReasonPayload } from "@/lib/chat/feedback-payload"

/**
 * ChatContent - 聊天内容组件（重构版）
 *
 * 直接从 useChatStore 读取状态，不再需要 Context。
 * Workflow 执行进度通过 Chat 内实时消息卡片展示，不再替换 Chat 区域。
 */

interface ChatContentProps {
  agent?: ChatAssistant
}

export function ChatContent({ agent }: ChatContentProps) {
  // 直接从 store 读取状态（使用选择器优化重渲染）
  const messages = useChatStore((state) => state.messages)
  const sessionId = useChatRuntimeStore((state) => state.sessionId)
  const activeMessageId = useChatRuntimeStore((state) => state.activeMessageId)
  const isTyping = activeMessageId !== null
  const statusMessageId = useChatRuntimeStore((state) => state.statusMessageId)
  const streamEnabled = useChatStore((state) => state.streamEnabled)
  const statusStage = useChatRuntimeStore((state) => state.statusStage)
  const statusCode = useChatRuntimeStore((state) => state.statusCode)
  const statusMeta = useChatRuntimeStore((state) => state.statusMeta)
  const sendFeedback = useChatStore((state) => state.sendFeedback)
  const setMessages = useChatStore((state) => state.setMessages)
  const {
    regenerateMessage,
    compareWithModel,
    finalizeCompareWinner,
  } = useChatMessagingService()
  useHydratePendingToolApproval(sessionId, messages)
  useBrowserModeToolActivity(messages)

  const workflowRun = useWorkflowStore((state) => state.run)
  const workflowSteps = useWorkflowStore((state) => state.steps)
  const workflowView = useWorkflowStore((state) => state.view)
  const setWorkflowRunDetail = useWorkflowStore((state) => state.setRunDetail)
  const setWorkflowError = useWorkflowStore((state) => state.setError)

  React.useEffect(() => {
    const runId = workflowRun?.id
    if (!runId || isWorkflowTerminal(workflowRun.status)) return

    let cancelled = false
    let unlisten: (() => void) | null = null

    async function subscribe() {
      try {
        const { listen } = await import("@tauri-apps/api/event")
        unlisten = await listen<{ run_id?: string; runId?: string }>(
          "workflow:run-updated",
          async (event) => {
            const updatedRunId = event.payload?.run_id ?? event.payload?.runId
            if (!updatedRunId || updatedRunId !== runId || cancelled) return
            try {
              const detail = await getWorkflowRunStatus(updatedRunId)
              if (!cancelled) setWorkflowRunDetail(detail)
            } catch (err) {
              if (!cancelled) {
                setWorkflowError(err instanceof Error ? err.message : String(err))
              }
            }
          },
        )
      } catch {
        // Web previews do not expose the Tauri event bridge.
      }
    }

    void subscribe()
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [setWorkflowError, setWorkflowRunDetail, workflowRun?.id, workflowRun?.status])

  // Inject or update workflow progress/receipt message in the chat stream
  React.useEffect(() => {
    if (!workflowRun) return

    const messageId = `workflow-receipt-${workflowRun.id}`

    if (isWorkflowTerminal(workflowRun.status)) {
      // Terminal state → show the result receipt
      const existing = messages.find((m) => m.id === messageId)
      const existingReceipt = existing?.metaInfo?.workflow_receipt
      if (
        existingReceipt &&
        typeof existingReceipt === "object" &&
        "status" in existingReceipt &&
        "updated_at" in existingReceipt &&
        existingReceipt.status === workflowRun.status &&
        existingReceipt.updated_at === workflowRun.updated_at
      ) {
        return
      }

      const nextReceipt: Message = {
        id: messageId,
        role: "assistant",
        content: "",
        createdAt: existing?.createdAt ?? Date.now(),
        metaInfo: {
          ...(existing?.metaInfo ?? {}),
          workflow_receipt: {
            run_id: workflowRun.id,
            status: workflowRun.status,
            updated_at: workflowRun.updated_at,
          },
        },
        blocks: buildWorkflowReceiptBlocks(workflowRun, workflowSteps),
      }

      setMessages(
        existing
          ? messages.map((m) => (m.id === messageId ? nextReceipt : m))
          : [...messages, nextReceipt]
      )
    } else if (workflowRun.status === "running" || workflowRun.status === "waiting_approval") {
      // Active state → show the live progress card
      const existing = messages.find((m) => m.id === messageId)

      const liveMessage: Message = {
        id: messageId,
        role: "assistant",
        content: "",
        createdAt: existing?.createdAt ?? Date.now(),
        metaInfo: {
          ...(existing?.metaInfo ?? {}),
          workflow_live: true,
        },
        blocks: buildWorkflowLiveBlocks(workflowRun, workflowSteps),
      }

      setMessages(
        existing
          ? messages.map((m) => (m.id === messageId ? liveMessage : m))
          : [...messages, liveMessage]
      )
    } else if (
      (workflowRun.status === "draft" || workflowRun.status === "ready") &&
      workflowView === "editor" &&
      workflowRun.snapshot_json?.phases?.length
    ) {
      // Plan ready → show the plan confirmation card in chat
      const planMessageId = `workflow-plan-${workflowRun.id}`
      const existing = messages.find((m) => m.id === planMessageId)
      if (existing) return // Already injected

      const planMessage: Message = {
        id: planMessageId,
        role: "assistant",
        content: "",
        createdAt: Date.now(),
        metaInfo: { workflow_plan: true },
        blocks: buildWorkflowPlanBlocks(workflowRun),
      }

      setMessages([...messages, planMessage])
    }
  }, [messages, setMessages, workflowRun, workflowSteps, workflowView])

  return (
    <div className="flex flex-1 min-h-0 h-full w-full">
      <ChatMessageList
        messages={messages}
        agent={agent}
        isTyping={isTyping}
        statusMessageId={statusMessageId}
        streamEnabled={streamEnabled}
        statusStage={statusStage}
        statusCode={statusCode}
        statusMeta={statusMeta}
        onRegenerate={regenerateMessage}
        onLike={(id, payload?: ChatFeedbackReasonPayload) => sendFeedback(id, 1, payload)}
        onDislike={(id, payload?: ChatFeedbackReasonPayload) => sendFeedback(id, -1, payload)}
        onCompareWithModel={compareWithModel}
        onFinalizeCompare={finalizeCompareWinner}
      />
    </div>
  )
}
