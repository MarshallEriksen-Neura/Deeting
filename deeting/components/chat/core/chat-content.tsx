"use client"

import * as React from "react"
import { ChatHeader } from "../header/chat-header"
import { ChatMessageList } from "../messages"
import { ChatInput } from "../input"
import { useChatContext } from "./chat-provider"
import { useChatStateStore, type ChatAssistant } from "@/store/chat-state-store"
import { useChatModels } from "@/hooks/chat/use-chat-models"
import { useChatAttachments } from "@/hooks/chat/use-chat-attachments"
import { useChatStream } from "@/hooks/chat/use-chat-stream"
import { useChatMessaging } from "@/hooks/chat/use-chat-messaging"
import type { ModelInfo } from "@/lib/api/models"

/**
 * ChatContent - 聊天内容组件
 * 
 * 职责：
 * - 组合聊天界面的三个主要部分（Header、MessageList、Input）
 * - 管理聊天交互逻辑（发送消息、模型选择、附件处理等）
 * - 协调各个子组件之间的数据流
 * 
 * 数据流：
 * 1. 从 props 接收助手信息和模型数据
 * 2. 使用自定义 hooks 管理各种交互状态
 * 3. 将状态和处理函数传递给子组件
 * 
 * Requirements: 1.1, 3.3, 11.1
 */

interface ChatContentProps {
  agent: ChatAssistant
  cloudModels: ModelInfo[]
  cloudModelGroups: any[]
  isLoadingModels: boolean
  isTauriRuntime: boolean
  onNewChat: () => void
}

export function ChatContent({
  agent,
  cloudModels,
  cloudModelGroups,
  isLoadingModels,
  isTauriRuntime,
  onNewChat,
}: ChatContentProps) {
  const { isTyping, statusStage, statusCode, statusMeta } = useChatContext()
  const { messages } = useChatStateStore()
  
  // 使用自定义 hooks
  const { selectedModelId, handleModelChange } = useChatModels({
    models: cloudModels,
    isLoadingModels,
  })
  
  const {
    attachments,
    attachmentError,
    handleFiles,
    handlePaste,
    removeAttachment,
    clearAttachments,
  } = useChatAttachments()
  
  const { streamEnabled, handleStreamChange } = useChatStream()
  
  const { handleSendMessage, hasContent, errorMessage, cancelActiveRequest } = useChatMessaging({
    agent,
    isTauriRuntime,
  })

  return (
    <>
      <ChatHeader 
        agent={agent}
        modelGroups={cloudModelGroups}
        selectedModelId={selectedModelId}
        onModelChange={handleModelChange}
        streamEnabled={streamEnabled}
        onStreamChange={handleStreamChange}
        isLoadingModels={isLoadingModels}
        onNewChat={onNewChat}
      />

      <ChatMessageList 
        messages={messages}
        agent={agent}
        isTyping={isTyping}
        streamEnabled={streamEnabled}
        statusStage={statusStage}
        statusCode={statusCode}
        statusMeta={statusMeta}
      />

      <ChatInputContainer
        agent={agent}
        attachments={attachments}
        attachmentError={attachmentError}
        errorMessage={errorMessage}
        streamEnabled={streamEnabled}
        isDisabled={isTyping || (!isTauriRuntime && isLoadingModels)}
        hasContent={hasContent}
        onSend={handleSendMessage}
        onCancel={cancelActiveRequest}
        onStreamChange={handleStreamChange}
        onRemoveAttachment={removeAttachment}
        onClearAttachments={clearAttachments}
        onPaste={handlePaste}
        isGenerating={isTyping}
      />
    </>
  )
}

interface ChatInputContainerProps {
  agent: ChatAssistant
  attachments: any[]
  attachmentError: string | null
  errorMessage: string | null
  streamEnabled: boolean
  isDisabled: boolean
  hasContent: boolean
  onSend: () => void
  onStreamChange: (enabled: boolean) => void
  onRemoveAttachment: (id: string) => void
  onClearAttachments: () => void
  onPaste: (event: React.ClipboardEvent<HTMLInputElement>) => void
  isGenerating: boolean
  onCancel: () => void
}

function ChatInputContainer({
  agent,
  attachments,
  attachmentError,
  errorMessage,
  streamEnabled,
  isDisabled,
  hasContent,
  onSend,
  onStreamChange,
  onRemoveAttachment,
  onClearAttachments,
  onPaste,
  isGenerating,
  onCancel,
}: ChatInputContainerProps) {
  const { input, setInput } = useChatContext()

  return (
    <ChatInput 
      inputValue={input}
      onInputChange={setInput}
      onSend={onSend}
      disabled={isDisabled}
      placeholderName={agent.name}
      errorMessage={attachmentError || errorMessage}
      attachments={attachments}
      onRemoveAttachment={onRemoveAttachment}
      onClearAttachments={onClearAttachments}
      streamEnabled={streamEnabled}
      onStreamChange={onStreamChange}
      onPaste={onPaste}
      isGenerating={isGenerating}
      onCancel={onCancel}
    />
  )
}
