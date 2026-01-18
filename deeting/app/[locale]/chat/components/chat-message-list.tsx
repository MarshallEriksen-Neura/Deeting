"use client"

import * as React from "react"
import { User } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { AIResponseBubble } from "./ai-response-bubble"
import { MarkdownViewer } from "@/components/chat/markdown-viewer"
import { normalizeMessage } from "@/lib/chat/message-normalizer"
import type { Message, ChatAssistant } from "@/store/chat-store"

interface ChatMessageListProps {
  messages: Message[]
  agent: ChatAssistant
  isTyping: boolean
  streamEnabled: boolean
  statusStage: string | null
  statusCode: string | null
  statusMeta: Record<string, unknown> | null
}

export function ChatMessageList({
  messages,
  agent,
  isTyping,
  streamEnabled,
  statusStage,
  statusCode,
  statusMeta,
}: ChatMessageListProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const lastAssistantId = React.useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]?.role === "assistant") return messages[i]?.id
    }
    return undefined
  }, [messages])
  const activeAssistantId = isTyping ? lastAssistantId : undefined

  // 自动滚动到底部
  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, isTyping])

  return (
    <ScrollArea className="flex-1 p-4">
      <div className="max-w-3xl mx-auto space-y-6 py-4">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={cn(
              "flex gap-3",
              msg.role === 'user' ? "flex-row-reverse" : "flex-row"
            )}
          >
            {/* 头像 */}
            <Avatar className="w-8 h-8 mt-1 border shadow-sm">
              {msg.role === 'assistant' ? (
                <>
                  <AvatarImage src={`https://api.dicebear.com/7.x/bottts/svg?seed=${agent.name}`} />
                  <AvatarFallback>AI</AvatarFallback>
                </>
              ) : (
                <AvatarFallback><User className="w-4 h-4" /></AvatarFallback>
              )}
            </Avatar>

            {/* 气泡 */}
            {msg.role === 'assistant' ? (
              <div className="flex-1 min-w-0">
                <AIResponseBubble
                  parts={normalizeMessage(msg.content)}
                  isActive={msg.id === activeAssistantId}
                  streamEnabled={streamEnabled}
                  statusStage={msg.id === activeAssistantId ? statusStage : null}
                  statusCode={msg.id === activeAssistantId ? statusCode : null}
                  statusMeta={msg.id === activeAssistantId ? statusMeta : null}
                  reveal={!isTyping && !streamEnabled && msg.id === lastAssistantId}
                />
                <div className="text-[10px] mt-1 opacity-70 text-muted-foreground text-left ml-1">
                  {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            ) : (
              <div className="relative max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed shadow-sm bg-primary text-primary-foreground rounded-tr-sm">
                <MarkdownViewer
                  content={msg.content}
                  className="chat-markdown chat-markdown-user"
                />
                <div className="text-[10px] mt-1 opacity-70 text-right text-primary-foreground/80">
                  {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            )}
          </div>
        ))}

        {isTyping && !activeAssistantId && (
          <div className="flex gap-3">
             <Avatar className="w-8 h-8 border shadow-sm">
                <AvatarImage src={`https://api.dicebear.com/7.x/bottts/svg?seed=${agent.name}`} />
                <AvatarFallback>AI</AvatarFallback>
             </Avatar>
             <div className="bg-muted/50 border border-border px-4 py-3 rounded-2xl rounded-tl-sm flex items-center gap-1">
               <span className="w-1.5 h-1.5 bg-muted-foreground/40 rounded-full animate-bounce [animation-delay:-0.3s]" />
               <span className="w-1.5 h-1.5 bg-muted-foreground/40 rounded-full animate-bounce [animation-delay:-0.15s]" />
               <span className="w-1.5 h-1.5 bg-muted-foreground/40 rounded-full animate-bounce" />
             </div>
          </div>
        )}
        <div ref={scrollRef} />
      </div>
    </ScrollArea>
  )
}
