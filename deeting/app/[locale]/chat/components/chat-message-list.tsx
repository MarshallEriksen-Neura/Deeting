"use client"

import * as React from "react"
import Image from "next/image"
import { ArrowDown, ArrowUp, User } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { AIResponseBubble } from "./ai-response-bubble"
import { MarkdownViewer } from "@/components/chat/markdown-viewer"
import { normalizeMessage } from "@/lib/chat/message-normalizer"
import type { Message, ChatAssistant } from "@/store/chat-store"
import { useI18n } from "@/hooks/use-i18n"
import type { ChatImageAttachment } from "@/lib/chat/message-content"

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
  const t = useI18n("chat")
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const scrollAreaRef = React.useRef<HTMLDivElement>(null)
  const [showScrollToBottom, setShowScrollToBottom] = React.useState(false)
  const [showScrollToTop, setShowScrollToTop] = React.useState(false)
  const [autoScrollEnabled, setAutoScrollEnabled] = React.useState(true)
  const imageAlt = t("input.image.alt")
  const lastAssistantId = React.useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]?.role === "assistant") return messages[i]?.id
    }
    return undefined
  }, [messages])
  const activeAssistantId = isTyping ? lastAssistantId : undefined

  // 自动滚动到底部（仅在用户未手动上滑时）
  React.useEffect(() => {
    if (!autoScrollEnabled) return
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, isTyping, autoScrollEnabled])

  const getViewport = React.useCallback(() => {
    return scrollAreaRef.current?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]') ?? null
  }, [])

  React.useEffect(() => {
    const viewport = getViewport()
    if (!viewport) return
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = viewport
      const distanceToBottom = scrollHeight - (scrollTop + clientHeight)
      const nearBottom = distanceToBottom < 120
      setShowScrollToBottom(!nearBottom)
      setShowScrollToTop(scrollTop > 120)
      setAutoScrollEnabled(nearBottom)
    }
    handleScroll()
    viewport.addEventListener("scroll", handleScroll)
    return () => viewport.removeEventListener("scroll", handleScroll)
  }, [getViewport])

  React.useEffect(() => {
    const viewport = getViewport()
    if (!viewport) return
    const { scrollTop, scrollHeight, clientHeight } = viewport
    const distanceToBottom = scrollHeight - (scrollTop + clientHeight)
    const nearBottom = distanceToBottom < 120
    setShowScrollToBottom(!nearBottom)
    setShowScrollToTop(scrollTop > 120)
    setAutoScrollEnabled(nearBottom)
  }, [messages, isTyping, getViewport])

  return (
    <div ref={scrollAreaRef} className="relative flex-1">
      <ScrollArea className="h-full p-4">
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
                {msg.attachments?.length ? (
                  <MessageAttachments attachments={msg.attachments} alt={imageAlt} />
                ) : null}
                <div className="text-[10px] mt-1 opacity-70 text-muted-foreground text-left ml-1">
                  {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            ) : (
              <div className="relative max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed shadow-sm bg-primary text-primary-foreground rounded-tr-sm">
                {msg.attachments?.length ? (
                  <div className="mb-3">
                    <MessageAttachments attachments={msg.attachments} variant="user" alt={imageAlt} />
                  </div>
                ) : null}
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
             <div className="flex-1 min-w-0">
               <AIResponseBubble 
                  parts={[]}
                  isActive={true} 
                  streamEnabled={streamEnabled}
                  statusStage={statusStage}
                  statusCode={statusCode}
                  statusMeta={statusMeta}
               />
             </div>
          </div>
        )}
        <div ref={scrollRef} />
        </div>
      </ScrollArea>

      <div className="pointer-events-none absolute bottom-4 right-4 flex flex-col gap-2">
        {showScrollToTop && (
          <Button
            variant="secondary"
            size="icon"
            className="pointer-events-auto h-9 w-9 rounded-full shadow-md"
            aria-label={t("scroll.toTop")}
            onClick={() => {
              const viewport = getViewport()
              viewport?.scrollTo({ top: 0, behavior: "smooth" })
            }}
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
        )}
        {showScrollToBottom && (
          <Button
            variant="secondary"
            size="icon"
            className="pointer-events-auto h-9 w-9 rounded-full shadow-md"
            aria-label={t("scroll.toBottom")}
            onClick={() => {
              setAutoScrollEnabled(true)
              scrollRef.current?.scrollIntoView({ behavior: "smooth" })
            }}
          >
            <ArrowDown className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  )
}

function MessageAttachments({
  attachments,
  variant = "assistant",
  alt,
}: {
  attachments: ChatImageAttachment[]
  variant?: "assistant" | "user"
  alt: string
}) {
  if (!attachments.length) return null
  const gridCols = attachments.length > 2 ? "grid-cols-3" : "grid-cols-2"
  const cardBg = variant === "user" ? "bg-white/10" : "bg-muted/40"

  return (
    <div className={cn("grid gap-2", gridCols)}>
      {attachments
        .filter((attachment) => attachment.url)
        .map((attachment) => (
        <div
          key={attachment.id}
          className={cn(
            "relative overflow-hidden rounded-xl border border-white/10 shadow-sm",
            cardBg
          )}
        >
          <Image
            src={attachment.url ?? ""}
            alt={attachment.name ?? alt}
            width={320}
            height={320}
            className="h-28 w-full object-cover"
            unoptimized
          />
          <div className="absolute inset-x-0 bottom-0 bg-black/35 px-2 py-1 text-[10px] text-white/80">
            <span className="truncate">
              {attachment.name ?? alt}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}
