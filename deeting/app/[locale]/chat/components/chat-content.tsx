"use client"

import * as React from "react"
import { ChatHeader } from "./chat-header"
import { ChatMessageList } from "./chat-message-list"
import { ChatInput } from "./chat-input"
import { useChatContext } from "./chat-provider"
import { useChatStateStore, type ChatAssistant } from "@/store/chat-state-store"
import { useChatModels } from "@/hooks/chat/use-chat-models"
import { useChatAttachments } from "@/hooks/chat/use-chat-attachments"
import { useChatStream } from "@/hooks/chat/use-chat-stream"
import { useChatMessaging } from "@/hooks/chat/use-chat-messaging"
import type { ModelInfo } from "@/lib/api/models"

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
  
  const { handleSendMessage, hasContent, errorMessage } = useChatMessaging({
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
        onStreamChange={handleStreamChange}
        onRemoveAttachment={removeAttachment}
        onClearAttachments={clearAttachments}
        onPaste={handlePaste}
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
    />
  )
}