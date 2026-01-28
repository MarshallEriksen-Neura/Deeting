"use client"

import { ChatMessageList } from "../messages"
import { useChatMessages } from "./chat-messages-context"
import { useChatConfig } from "./chat-config-context"
import { useChatStateStore, type ChatAssistant } from "@/store/chat-state-store"
import { useChatStream } from "@/hooks/chat/use-chat-stream"

/**
 * ChatContent - 聊天内容组件
 * 
 * 职责：
 * - 渲染聊天消息列表
 * - HUD/Controls 负责顶部状态与输入交互
 * 
 * 数据流：
 * 1. 从 store 读取消息与状态
 * 2. 渲染消息列表并处理滚动状态
 * 
 * Requirements: 1.1, 3.3, 11.1
 */

interface ChatContentProps {
  agent: ChatAssistant
}

export function ChatContent({
  agent,
}: ChatContentProps) {
  const { isTyping } = useChatMessages()
  const { statusStage, statusCode, statusMeta } = useChatConfig()
  const { messages } = useChatStateStore()
  const { streamEnabled } = useChatStream()

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
