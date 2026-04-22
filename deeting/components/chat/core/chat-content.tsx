"use client"
import { ToolApprovalDialog } from "@/components/bridge/tool-approval-dialog"
import { ChatMessageList } from "../messages"
import { useChatStore, type ChatAssistant } from "@/store/chat-store"
import { useChatRuntimeStore } from "@/store/chat-runtime-store"
import { useChatMessagingService } from "@/hooks/chat/use-chat-messaging-service"
import { useHydratePendingToolApproval } from "@/hooks/chat/use-hydrate-pending-tool-approval"
import { useBrowserModeToolActivity } from "@/hooks/chat/use-browser-mode-tool-activity"

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

  return (
    <>
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
          onLike={(id) => void sendFeedback(id, 1)}
          onDislike={(id) => void sendFeedback(id, -1)}
          onCompareWithModel={compareWithModel}
          onFinalizeCompare={finalizeCompareWinner}
        />
      </div>
      <ToolApprovalDialog />
    </>
  )
}
