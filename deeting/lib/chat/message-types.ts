import type { ChatImageAttachment } from "@/lib/chat/message-content"
import type { MessageBlock } from "@/lib/chat/message-protocol"

export type MessageRole = "user" | "assistant" | "system"

export type ToolCall = {
  id?: string
  type?: string
  function?: {
    name?: string
    arguments?: unknown
  }
  [key: string]: unknown
}

export type ToolOutput = {
  call_id?: string
  result?: unknown
}

export type MessageMetaInfo = {
  tool_calls?: ToolCall[]
  tool_call_id?: string
  function_call?: Record<string, unknown>
  content?: unknown
  attachments?: unknown
  image_url?: unknown
  audio?: unknown
  modalities?: unknown
  [key: string]: unknown
}

export interface Message {
  id: string
  role: MessageRole
  content: string
  attachments?: ChatImageAttachment[]
  createdAt: number
  metaInfo?: MessageMetaInfo
  toolCalls?: ToolCall[]
  toolCallId?: string
  toolOutputs?: ToolOutput[]
  blocks?: MessageBlock[]
}
