"use client"

import * as React from "react"
import { User } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { AIResponseBubble, type MessagePart } from "./ai-response-bubble"
import type { Message, ChatAssistant } from "@/store/chat-store"

interface ChatMessageListProps {
  messages: Message[]
  agent: ChatAssistant
  isTyping: boolean
}

function parseMessageContent(content: string): MessagePart[] {
  const parts: MessagePart[] = [];
  const thinkRegex = /<think>([\s\S]*?)<\/think>/g;
  let lastIndex = 0;
  let match;

  while ((match = thinkRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      const text = content.substring(lastIndex, match.index);
      if (text.trim()) parts.push({ type: 'text', content: text });
    }
    parts.push({ type: 'thought', content: match[1].trim() });
    lastIndex = thinkRegex.lastIndex;
  }
  
  if (lastIndex < content.length) {
    const text = content.substring(lastIndex);
    if (text.trim()) parts.push({ type: 'text', content: text });
  }
  
  if (parts.length === 0 && content) {
    return [{ type: 'text', content }];
  }
  return parts;
}

export function ChatMessageList({ messages, agent, isTyping }: ChatMessageListProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null)

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
                <AIResponseBubble parts={parseMessageContent(msg.content)} />
                <div className="text-[10px] mt-1 opacity-70 text-muted-foreground text-left ml-1">
                  {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            ) : (
              <div className="relative max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed shadow-sm bg-primary text-primary-foreground rounded-tr-sm">
                <div className="whitespace-pre-wrap">{msg.content}</div>
                <div className="text-[10px] mt-1 opacity-70 text-right text-primary-foreground/80">
                  {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            )}
          </div>
        ))}

        {isTyping && (
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
