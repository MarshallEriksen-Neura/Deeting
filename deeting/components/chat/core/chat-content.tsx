"use client"
import * as React from "react"
import { ChatMessageList } from "../messages"
import { useChatStore, type ChatAssistant } from "@/store/chat-store"
import { useChatRuntimeStore } from "@/store/chat-runtime-store"
import { useChatMessagingService } from "@/hooks/chat/use-chat-messaging-service"
import { useHydratePendingToolApproval } from "@/hooks/chat/use-hydrate-pending-tool-approval"
import { useBrowserModeToolActivity } from "@/hooks/chat/use-browser-mode-tool-activity"
import { useWorkspaceStore } from "@/store/workspace-store"
import { useWorkflowStore } from "@/store/workflow-store"
import { TerminalDashboard } from "@/components/dashboard/terminal-dashboard"

/**
 * ChatContent - 聊天内容组件（重构版）
 *
 * 直接从 useChatStore 读取状态，不再需要 Context
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
  const {
    regenerateMessage,
    compareWithModel,
    finalizeCompareWinner,
  } = useChatMessagingService()
  useHydratePendingToolApproval(sessionId, messages)
  useBrowserModeToolActivity(messages)

  const activeViewId = useWorkspaceStore((state) => state.activeViewId)
  const views = useWorkspaceStore((state) => state.views)
  
  const isWorkflowActiveInWorkspace = React.useMemo(() => {
    const activeView = views.find(v => v.id === activeViewId)
    return activeView?.type === "native-canvas" && activeView.content?.viewType === "workflow"
  }, [activeViewId, views])

  const workflowViewStatus = useWorkflowStore((state) => state.view)
  const workflowRun = useWorkflowStore((state) => state.run)
  const workflowSteps = useWorkflowStore((state) => state.steps)
  const workflowEvents = useWorkflowStore((state) => state.events)
  const isWorkflowExecuting = isWorkflowActiveInWorkspace && workflowViewStatus === "execution"

  return (
    <div className="flex flex-1 min-h-0 h-full w-full">
      {isWorkflowExecuting ? (
        <div className="flex-1 w-full h-full animate-in fade-in slide-in-from-bottom-2 duration-500">
          <TerminalDashboard
            workflowRun={workflowRun}
            workflowSteps={workflowSteps}
            workflowEvents={workflowEvents}
          />
        </div>
      ) : (
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
          onLike={(id) => void sendFeedback(id, 1)}
          onDislike={(id) => void sendFeedback(id, -1)}
          onCompareWithModel={compareWithModel}
          onFinalizeCompare={finalizeCompareWinner}
        />
      )}
    </div>
  )
}
