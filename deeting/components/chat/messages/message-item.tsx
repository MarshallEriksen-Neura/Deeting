"use client"

import * as React from "react"
import Image from "next/image"
import { User } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import { AIResponseBubble } from "./ai-response-bubble"
import { MarkdownViewer } from "@/components/chat/markdown-viewer"
import { normalizeMessage } from "@/lib/chat/message-normalizer"
import type { Message, ChatAssistant } from "@/store/chat-store"
import { useI18n } from "@/hooks/use-i18n"
import type { ChatImageAttachment } from "@/lib/chat/message-content"
import { ImageLightbox } from "@/components/ui/image-lightbox"

interface MessageItemProps {
  message: Message
  agent: ChatAssistant
  isActive?: boolean
  streamEnabled?: boolean
  statusStage?: string | null
  statusCode?: string | null
  statusMeta?: Record<string, unknown> | null
  lastAssistantId?: string
  isTyping?: boolean
}

/**
 * MessageItem 组件 - 单条消息展示组件
 * 
 * 使用 React.memo 优化，避免不必要的重渲染
 * 支持用户消息和助手消息的不同展示样式
 * 支持附件预览和时间戳显示
 * 
 * Requirements: 2.2, 2.5, 3.1
 */
export const MessageItem = React.memo<MessageItemProps>(
  ({
    message,
    agent,
    isActive = false,
    streamEnabled = false,
    statusStage = null,
    statusCode = null,
    statusMeta = null,
    lastAssistantId,
    isTyping = false,
  }) => {
    const t = useI18n("chat")
    const imageAlt = t("input.image.alt")

    // 判断是否为最后一条助手消息（用于 reveal 动画）
    const isLastAssistantMessage = message.role === "assistant" && message.id === lastAssistantId
    const shouldReveal = !isTyping && !streamEnabled && isLastAssistantMessage

    return (
      <div
        className={cn(
          "flex gap-3",
          message.role === "user" ? "flex-row-reverse" : "flex-row"
        )}
      >
        {/* 头像 */}
        <Avatar className="w-8 h-8 mt-1 border shadow-sm">
          {message.role === "assistant" ? (
            <>
              <AvatarImage
                src={`https://api.dicebear.com/7.x/bottts/svg?seed=${agent.name}`}
              />
              <AvatarFallback>AI</AvatarFallback>
            </>
          ) : (
            <AvatarFallback>
              <User className="w-4 h-4" />
            </AvatarFallback>
          )}
        </Avatar>

        {/* 消息气泡 */}
        {message.role === "assistant" ? (
          <div className="flex-1 min-w-0">
            <AIResponseBubble
              parts={message.blocks ?? normalizeMessage(message.content)}
              isActive={isActive}
              streamEnabled={streamEnabled}
              statusStage={isActive ? statusStage : null}
              statusCode={isActive ? statusCode : null}
              statusMeta={isActive ? statusMeta : null}
              reveal={shouldReveal}
            />
            {message.attachments?.length ? (
              <MessageAttachments
                attachments={message.attachments}
                alt={imageAlt}
              />
            ) : null}
            <div className="text-[10px] mt-1 opacity-70 text-muted-foreground text-left ml-1">
              {new Date(message.createdAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
          </div>
        ) : (
          <div className="relative max-w-[85%] px-5 py-3.5 rounded-2xl rounded-tr-none text-[15px] leading-relaxed tracking-wide shadow-md bg-primary text-primary-foreground">
            {message.attachments?.length ? (
              <div className="mb-3">
                <MessageAttachments
                  attachments={message.attachments}
                  variant="user"
                  alt={imageAlt}
                />
              </div>
            ) : null}
            <MarkdownViewer
              content={message.content}
              className="chat-markdown chat-markdown-user"
            />
            <div className="text-[10px] mt-1 opacity-70 text-right text-primary-foreground/80">
              {new Date(message.createdAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
          </div>
        )}
      </div>
    )
  },
  // 自定义比较函数，只在必要时重渲染
  (prevProps, nextProps) => {
    // 消息 ID 和内容相同
    const messageUnchanged =
      prevProps.message.id === nextProps.message.id &&
      prevProps.message.content === nextProps.message.content &&
      prevProps.message.blocks === nextProps.message.blocks

    // 附件未变化
    const attachmentsUnchanged =
      prevProps.message.attachments?.length ===
        nextProps.message.attachments?.length &&
      prevProps.message.attachments?.every(
        (att, idx) =>
          att.id === nextProps.message.attachments?.[idx]?.id &&
          att.url === nextProps.message.attachments?.[idx]?.url
      )

    // 激活状态未变化
    const activeStateUnchanged = prevProps.isActive === nextProps.isActive

    // 状态信息未变化（仅在激活时比较）
    const statusUnchanged =
      !nextProps.isActive ||
      (prevProps.statusStage === nextProps.statusStage &&
        prevProps.statusCode === nextProps.statusCode)

    // 流式配置未变化
    const streamUnchanged = prevProps.streamEnabled === nextProps.streamEnabled

    // 助手信息未变化
    const agentUnchanged = prevProps.agent.id === nextProps.agent.id

    // lastAssistantId 未变化
    const lastAssistantIdUnchanged =
      prevProps.lastAssistantId === nextProps.lastAssistantId

    // isTyping 未变化
    const isTypingUnchanged = prevProps.isTyping === nextProps.isTyping

    return (
      messageUnchanged &&
      attachmentsUnchanged &&
      activeStateUnchanged &&
      statusUnchanged &&
      streamUnchanged &&
      agentUnchanged &&
      lastAssistantIdUnchanged &&
      isTypingUnchanged
    )
  }
)

MessageItem.displayName = "MessageItem"

/**
 * MessageAttachments 组件 - 消息附件展示
 * 
 * 支持用户消息和助手消息的不同样式
 * 使用 ImageLightbox 支持图片放大查看
 * 使用 React.memo 优化性能
 */
interface MessageAttachmentsProps {
  attachments: ChatImageAttachment[]
  variant?: "assistant" | "user"
  alt: string
}

const MessageAttachments = React.memo<MessageAttachmentsProps>(
  ({ attachments, variant = "assistant", alt }) => {
    if (!attachments.length) return null

    const gridCols = attachments.length > 2 ? "grid-cols-3" : "grid-cols-2"
    const cardBg = variant === "user" ? "bg-white/10" : "bg-muted/40"

    return (
      <div className={cn("grid gap-2", gridCols)}>
        {attachments
          .filter((attachment) => attachment.url)
          .map((attachment) => (
            <ImageLightbox
              key={attachment.id}
              src={attachment.url ?? ""}
              alt={attachment.name ?? alt}
            >
              <div
                className={cn(
                  "relative overflow-hidden rounded-xl border border-white/10 shadow-sm cursor-zoom-in group",
                  cardBg
                )}
              >
                <Image
                  src={attachment.url ?? ""}
                  alt={attachment.name ?? alt}
                  width={320}
                  height={320}
                  className="h-28 w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  unoptimized
                />
                <div className="absolute inset-x-0 bottom-0 bg-black/35 px-2 py-1 text-[10px] text-white/80">
                  <span className="truncate">{attachment.name ?? alt}</span>
                </div>
              </div>
            </ImageLightbox>
          ))}
      </div>
    )
  },
  (prevProps, nextProps) => {
    // 附件数量和内容未变化
    const attachmentsUnchanged =
      prevProps.attachments.length === nextProps.attachments.length &&
      prevProps.attachments.every(
        (att, idx) =>
          att.id === nextProps.attachments[idx]?.id &&
          att.url === nextProps.attachments[idx]?.url &&
          att.name === nextProps.attachments[idx]?.name
      )

    // variant 未变化
    const variantUnchanged = prevProps.variant === nextProps.variant

    // alt 未变化
    const altUnchanged = prevProps.alt === nextProps.alt

    return attachmentsUnchanged && variantUnchanged && altUnchanged
  }
)

MessageAttachments.displayName = "MessageAttachments"
