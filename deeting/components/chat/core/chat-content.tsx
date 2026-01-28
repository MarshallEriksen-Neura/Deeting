"use client"

import { ChatMessageList } from "../messages"
import { useChatStore, type ChatAssistant } from "@/store/chat-store"

/**
 * ChatContent - 聊天内容组件（重构版）
 *
 * 直接从 useChatStore 读取状态，不再需要 Context
 */

interface ChatContentProps {
  agent: ChatAssistant
}

export function ChatContent({ agent }: ChatContentProps) {
  // 直接从 store 读取状态（使用选择器优化重渲染）
  const messages = useChatStore((state) => state.messages)
  // isLoading = history loading, NOT typing. Only treat as typing when streaming.
  const isTyping = useChatStore((state) => state.statusStage !== null)
  const streamEnabled = useChatStore((state) => state.streamEnabled)
  const statusStage = useChatStore((state) => state.statusStage)
  const statusCode = useChatStore((state) => state.statusCode)
  const statusMeta = useChatStore((state) => state.statusMeta)

  return (
    <div className="flex flex-1 min-h-0">
      <ChatMessageList
        messages={messages}
        agent={agent}
        isTyping={isTyping}
        streamEnabled={streamEnabled}
        statusStage={statusStage}
        statusCode={statusCode}
        statusMeta={statusMeta}
      />
    </div>
  )
}
