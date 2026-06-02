"use client"

import * as React from "react"
import Image from "next/image"
import { FileText } from "lucide-react"
import dynamic from "next/dynamic"
import { cn } from "@/lib/utils"
import { AIResponseBubble } from "./ai-response-bubble"
import { CompareResponseShell } from "./compare-response-shell"
import { MessageActions, UserMessageActions } from "./message-actions"
import { WikiCrystallizationCard } from "./ai-response-bubble/wiki-crystallization-card"
import { MarkdownViewer } from "@/components/chat/markdown-viewer"
import { useChatStore, type Message, type ChatAssistant } from "@/store/chat-store"
import { useChatRuntimeStore } from "@/store/chat-runtime-store"
import { useI18n } from "@/hooks/use-i18n"
import type { ChatAttachment } from "@/lib/chat/message-content"
import type { ChatFeedbackReasonPayload } from "@/lib/chat/feedback-payload"
import { ImageLightbox } from "@/ui/common/image-lightbox"
import type { MessageBlock } from "@/lib/chat/message-protocol"
import { formatFileSize } from "@/lib/utils/file"
import { useMessageToolApproval } from "@/hooks/chat/use-message-tool-approval"

const CompareModelDialog = dynamic(
  () => import("./compare-model-dialog").then((module) => module.CompareModelDialog),
  { ssr: false }
)

interface MessageItemProps {
  message: Message
  agent?: ChatAssistant
  isActive?: boolean
  streamEnabled?: boolean
  statusStage?: string | null
  statusCode?: string | null
  statusMeta?: Record<string, unknown> | null
  lastAssistantId?: string
  isTyping?: boolean
  onRegenerate?: (messageId: string) => void
  onRegenerateUserMessage?: (messageId: string) => void
  onDeleteUserMessage?: (messageId: string) => void
  onLike?: (messageId: string, payload?: ChatFeedbackReasonPayload) => void | Promise<void>
  onDislike?: (messageId: string, payload?: ChatFeedbackReasonPayload) => void | Promise<void>
  onCopy?: (messageId: string) => void
  onCompareWithModel?: (messageId: string, modelValue: string) => void
  onFinalizeCompare?: (messageId: string, modelKey: string) => void
}

type RuntimeMetrics = {
  totalLatencyMs: number | null
  upstreamLatencyMs: number | null
  localLatencyMs: number | null
}

const toPositiveMs = (value: unknown): number | null => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return Math.round(parsed)
}

const formatLatencyValue = (ms: number) => {
  if (ms >= 1000) {
    const seconds = ms / 1000
    return seconds >= 10 ? `${seconds.toFixed(1)}s` : `${seconds.toFixed(2)}s`
  }
  return `${ms}ms`
}

const extractRuntimeMetrics = (metaInfo?: Record<string, unknown>): RuntimeMetrics | null => {
  const raw = metaInfo?.runtime_metrics
  if (!raw || typeof raw !== "object") return null
  const metrics = raw as Record<string, unknown>
  const totalLatencyMs = toPositiveMs(metrics.total_latency_ms ?? metrics.latency_ms)
  const upstreamLatencyMs = toPositiveMs(metrics.upstream_latency_ms)
  const localLatencyMs =
    toPositiveMs(metrics.orchestrator_latency_ms) ??
    (totalLatencyMs !== null && upstreamLatencyMs !== null
      ? Math.max(totalLatencyMs - upstreamLatencyMs, 0)
      : null)

  if (totalLatencyMs === null && upstreamLatencyMs === null && localLatencyMs === null) {
    return null
  }
  return {
    totalLatencyMs,
    upstreamLatencyMs,
    localLatencyMs,
  }
}

const isWorkflowUiBlock = (block: MessageBlock) =>
  block.type === "ui" && block.viewType.startsWith("workflow.")

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
    isActive = false,
    streamEnabled = false,
    statusStage = null,
    statusCode = null,
    statusMeta = null,
    lastAssistantId,
    isTyping = false,
    onRegenerate,
    onRegenerateUserMessage,
    onDeleteUserMessage,
    onLike,
    onDislike,
    onCopy,
    onCompareWithModel,
    onFinalizeCompare,
  }) => {
    const t = useI18n("chat")
    const imageAlt = t("input.image.alt")
    const focusedMessageId = useChatStore((state) => state.focusedMessageId)
    const focusMessage = useChatStore((state) => state.focusMessage)
    const compareState = useChatStore(
      React.useCallback((state) => state.compareByMessageId[message.id] ?? null, [message.id])
    )
    const models = useChatStore((state) => state.models)
    const [compareDialogOpen, setCompareDialogOpen] = React.useState(false)
    const [wikiDialogOpen, setWikiDialogOpen] = React.useState(false)
    const messageMetaInfo = message.metaInfo as Record<string, unknown> | undefined

    // 判断是否为最后一条助手消息（用于 reveal 动画）
    // 无论 stream 是否开启，只要是最新的非历史助手消息就启用打字机效果
    const isLastAssistantMessage = message.role === "assistant" && message.id === lastAssistantId
    const typingEnabled = isLastAssistantMessage && !message.fromHistory
    const assistantParts = React.useMemo<MessageBlock[]>(() => {
      if (message.role !== "assistant") return []
      return message.blocks ?? []
    }, [message.blocks, message.role])
    useMessageToolApproval(message.role === "assistant" ? message.id : null, assistantParts, {
      fromHistory: Boolean(message.fromHistory),
    })
    const activeCompareCandidate = compareState?.candidates[compareState.activeModelKey] ?? null
    const runtimeMetricsSummary = React.useMemo(() => {
      if (message.role !== "assistant") return null
      const metrics = extractRuntimeMetrics(messageMetaInfo)
      if (!metrics) return null
      const parts: string[] = []
      if (metrics.totalLatencyMs !== null) {
        parts.push(t("status.metrics.total", { value: formatLatencyValue(metrics.totalLatencyMs) }))
      }
      if (metrics.upstreamLatencyMs !== null) {
        parts.push(t("status.metrics.upstream", { value: formatLatencyValue(metrics.upstreamLatencyMs) }))
      }
      if (metrics.localLatencyMs !== null) {
        parts.push(t("status.metrics.local", { value: formatLatencyValue(metrics.localLatencyMs) }))
      }
      return parts.length > 0 ? parts.join(" · ") : null
    }, [message.role, messageMetaInfo, t])
    const messageUsage = useChatRuntimeStore(
      React.useCallback((state) => state.sessionUsage?.messageUsages?.[message.id] ?? null, [message.id])
    )
    const tokenUsageSummary = React.useMemo(() => {
      if (message.role !== "assistant" || !messageUsage) return null
      const total = messageUsage.totalTokens
      if (!total) return null
      const formatted = total >= 1000 ? `${(total / 1000).toFixed(1)}k` : String(total)
      return `${formatted} tokens`
    }, [message.role, messageUsage])
    const assistantCopyContent = React.useMemo(() => {
      if (activeCompareCandidate) {
        return activeCompareCandidate.content
      }
      if (message.role !== "assistant") return message.content
      return assistantParts.reduce((acc, block) => {
        if (block.type === "text") {
          return typeof block.content === "string" ? `${acc}${block.content}` : acc
        }
        if (block.type === "error") {
          return typeof block.message === "string" ? `${acc}${block.message}` : acc
        }
        return acc
      }, "")
    }, [activeCompareCandidate, assistantParts, message.content, message.role])
    const isWorkflowAssistantMessage = React.useMemo(() => {
      if (message.role !== "assistant") return false
      if (
        messageMetaInfo?.workflow_live ||
        messageMetaInfo?.workflow_plan ||
        messageMetaInfo?.workflow_receipt
      ) {
        return true
      }
      return assistantParts.some(isWorkflowUiBlock)
    }, [assistantParts, message.role, messageMetaInfo])
    const hasAssistantActionContent = assistantCopyContent.trim().length > 0
    const canShowMessageActions =
      message.role === "assistant" && !isActive && !isWorkflowAssistantMessage
    const canCompare =
      message.role === "assistant" &&
      message.id === lastAssistantId &&
      !message.fromHistory &&
      canShowMessageActions &&
      hasAssistantActionContent &&
      !compareState
    const canSaveToWiki =
      message.role === "assistant" &&
      canShowMessageActions &&
      hasAssistantActionContent &&
      Boolean(message.id)
    const userDisplayContent = React.useMemo(() => {
      if (message.role !== "user") return message.content
      const displayContent =
        typeof messageMetaInfo?.display_content === "string"
          ? messageMetaInfo.display_content.trim()
          : ""
      return displayContent || message.content
    }, [message.content, messageMetaInfo, message.role])
    const userPageContextLabel = React.useMemo(() => {
      if (message.role !== "user") return null
      const pageContext =
        messageMetaInfo?.page_context && typeof messageMetaInfo.page_context === "object"
          ? (messageMetaInfo.page_context as Record<string, unknown>)
          : null
      const title =
        typeof pageContext?.title === "string" && pageContext.title.trim().length > 0
          ? pageContext.title.trim()
          : ""
      const host =
        typeof pageContext?.host === "string" && pageContext.host.trim().length > 0
          ? pageContext.host.trim()
          : ""
      if (!title && !host) return null
      return title || host
    }, [message.role, messageMetaInfo])
    const excludedModelKeys = React.useMemo(() => {
      if (compareState) {
        return Object.keys(compareState.candidates)
      }
      const modelKey =
        typeof messageMetaInfo?.provider_model_id === "string"
          ? messageMetaInfo.provider_model_id
          : typeof messageMetaInfo?.model_id === "string"
            ? messageMetaInfo.model_id
            : null
      return modelKey ? [modelKey] : []
    }, [compareState, messageMetaInfo])
    const isFocusedMessage = focusedMessageId === message.id
    const canShowUserActions =
      message.role === "user" &&
      !isActive &&
      typeof message.turnIndex === "number" &&
      (Boolean(onRegenerateUserMessage) || Boolean(onDeleteUserMessage) || userDisplayContent.trim().length > 0)
    const itemRef = React.useRef<HTMLDivElement | null>(null)

    React.useEffect(() => {
      if (!isFocusedMessage) return
      itemRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      })
      const timer = window.setTimeout(() => {
        if (useChatStore.getState().focusedMessageId === message.id) {
          focusMessage(null)
        }
      }, 2200)
      return () => window.clearTimeout(timer)
    }, [focusMessage, isFocusedMessage, message.id])

    return (
      <div
        ref={itemRef}
        data-message-id={message.id}
        className={cn(
          "flex w-full min-w-0 gap-3 shrink-0 rounded-2xl transition-all duration-300",
          isFocusedMessage && "bg-amber-500/10 ring-1 ring-amber-400/30 px-2 py-2 -mx-2",
          "flex-row"
        )}
      >
        {/* 消息气泡 */}
        {message.role === "assistant" ? (
          <div className="w-full max-w-[85%]">
            {compareState && onCompareWithModel && onFinalizeCompare ? (
              <CompareResponseShell
                messageId={message.id}
                compareState={compareState}
                models={models}
                onCompare={onCompareWithModel}
                onFinalize={onFinalizeCompare}
              />
            ) : (
              <AIResponseBubble
                messageId={message.id}
                parts={assistantParts}
                isActive={isActive}
                streamEnabled={streamEnabled}
                typingEnabled={typingEnabled}
                statusStage={isActive ? statusStage : null}
                statusCode={statusCode}
                statusMeta={statusMeta}
              />
            )}
            {message.attachments?.length ? (
              <MessageAttachments
                attachments={message.attachments}
                alt={imageAlt}
              />
            ) : null}
            <div className="flex items-center mt-1 ml-1">
              {canShowMessageActions && (
                <MessageActions
                  messageId={message.id}
                  content={assistantCopyContent}
                  onRegenerate={onRegenerate}
                  onLike={onLike}
                  onDislike={onDislike}
                  onCopy={onCopy}
                  onCompare={() => setCompareDialogOpen(true)}
                  onSaveToWiki={() => setWikiDialogOpen(true)}
                  canCompare={canCompare}
                  canSaveToWiki={canSaveToWiki}
                  liked={messageMetaInfo?.feedback_score === 1}
                  disliked={messageMetaInfo?.feedback_score === -1}
                  disabled={isActive || compareState?.isFinalizing}
                />
              )}
              <div className="ml-auto flex items-center gap-2">
                {!isActive && runtimeMetricsSummary ? (
                  <span className="text-[10px] text-muted-foreground/80">
                    {runtimeMetricsSummary}
                  </span>
                ) : null}
                <span className="text-[10px] opacity-70 text-muted-foreground">
                  {new Date(message.createdAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                {!isActive && tokenUsageSummary ? (
                  <span className="text-[10px] text-muted-foreground/80">
                    {tokenUsageSummary}
                  </span>
                ) : null}
              </div>
            </div>
            {onCompareWithModel && compareDialogOpen ? (
              <CompareModelDialog
                open={compareDialogOpen}
                onOpenChange={setCompareDialogOpen}
                models={models}
                excludedModelKeys={excludedModelKeys}
                onSelect={(modelValue) => onCompareWithModel(message.id, modelValue)}
              />
            ) : null}
            <WikiCrystallizationCard
              open={wikiDialogOpen}
              onOpenChange={setWikiDialogOpen}
              message={message}
              content={assistantCopyContent}
              disabled={isActive || compareState?.isFinalizing}
            />
          </div>
        ) : (
          <div className="flex min-w-0 max-w-[85%] flex-col gap-1.5">
            <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/60">
              {t("message.you")}
            </div>
            <div className="chat-user-bubble relative max-w-full rounded-xl border px-4 py-3 text-[15px] font-normal leading-[1.48] tracking-normal">
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
                content={userDisplayContent}
                className="chat-markdown chat-markdown-user"
              />
            </div>
            <div className="chat-user-bubble-meta px-1 text-[11px]">
              {userPageContextLabel ? (
                <div className="mb-1 inline-flex max-w-full items-center gap-1 rounded-full border border-emerald-200/80 bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-200">
                  <span className="truncate">
                    {t("controls.pageContextUsed", { value: userPageContextLabel })}
                  </span>
                </div>
              ) : null}
              {new Date(message.createdAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
            {canShowUserActions ? (
              <UserMessageActions
                messageId={message.id}
                content={userDisplayContent}
                onRegenerate={onRegenerateUserMessage}
                onDelete={onDeleteUserMessage}
                onCopy={onCopy}
                disabled={isActive || isTyping}
                className="mt-0 ml-0"
              />
            ) : null}
          </div>
        )}
      </div>
    )
  },
  // 自定义比较函数，只在必要时重渲染
  (prevProps, nextProps) => {
    // 消息 ID 和内容相同
    const assistantContentUnchanged =
      prevProps.message.role === "assistant" && nextProps.message.role === "assistant"
        ? true
        : prevProps.message.content === nextProps.message.content
    const messageUnchanged =
      prevProps.message.id === nextProps.message.id &&
      assistantContentUnchanged &&
      prevProps.message.turnIndex === nextProps.message.turnIndex &&
      prevProps.message.metaInfo?.display_content ===
        nextProps.message.metaInfo?.display_content &&
      (prevProps.message.metaInfo as Record<string, unknown> | undefined)?.page_context ===
        (nextProps.message.metaInfo as Record<string, unknown> | undefined)?.page_context &&
      prevProps.message.blocks === nextProps.message.blocks

    // 附件未变化
    const prevAttachments = prevProps.message.attachments ?? []
    const nextAttachments = nextProps.message.attachments ?? []
    const attachmentsUnchanged =
      prevAttachments.length === nextAttachments.length &&
      prevAttachments.every(
        (att, idx) =>
          att.id === nextAttachments[idx]?.id &&
          att.url === nextAttachments[idx]?.url
      )

    // 激活状态未变化
    const activeStateUnchanged = prevProps.isActive === nextProps.isActive

    // 状态信息未变化（仅在激活时比较）
    const statusUnchanged =
      !nextProps.isActive ||
      (prevProps.statusStage === nextProps.statusStage &&
        prevProps.statusCode === nextProps.statusCode &&
        JSON.stringify(prevProps.statusMeta) === JSON.stringify(nextProps.statusMeta))

    // 流式配置未变化
    const streamUnchanged = prevProps.streamEnabled === nextProps.streamEnabled

    // 助手信息未变化
    const agentUnchanged = prevProps.agent?.id === nextProps.agent?.id

    // lastAssistantId 未变化
    const lastAssistantIdUnchanged =
      prevProps.lastAssistantId === nextProps.lastAssistantId

    // isTyping 未变化
    const isTypingUnchanged = prevProps.isTyping === nextProps.isTyping

    // 回调未变化
    const callbacksUnchanged =
      prevProps.onRegenerate === nextProps.onRegenerate &&
      prevProps.onRegenerateUserMessage === nextProps.onRegenerateUserMessage &&
      prevProps.onDeleteUserMessage === nextProps.onDeleteUserMessage &&
      prevProps.onLike === nextProps.onLike &&
      prevProps.onDislike === nextProps.onDislike &&
      prevProps.onCopy === nextProps.onCopy &&
      prevProps.onCompareWithModel === nextProps.onCompareWithModel &&
      prevProps.onFinalizeCompare === nextProps.onFinalizeCompare

    return (
      messageUnchanged &&
      attachmentsUnchanged &&
      activeStateUnchanged &&
      statusUnchanged &&
      streamUnchanged &&
      agentUnchanged &&
      lastAssistantIdUnchanged &&
      isTypingUnchanged &&
      callbacksUnchanged
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
  attachments: ChatAttachment[]
  variant?: "assistant" | "user"
  alt: string
}

const MessageAttachments = React.memo<MessageAttachmentsProps>(
  ({ attachments, variant = "assistant", alt }) => {
    if (!attachments.length) return null

    const imageAttachments = attachments.filter(
      (attachment) =>
        !(attachment.kind === "file" || attachment.fileId) && Boolean(attachment.url)
    )
    const fileAttachments = attachments.filter(
      (attachment) => attachment.kind === "file" || Boolean(attachment.fileId)
    )
    const gridCols = imageAttachments.length > 2 ? "grid-cols-3" : "grid-cols-2"
    const cardBg = variant === "user" ? "chat-user-attachment-card" : "border-white/10 bg-muted/40"

    return (
      <div className="space-y-2">
        {imageAttachments.length ? (
          <div className={cn("grid gap-2", gridCols)}>
            {imageAttachments.map((attachment) => (
              <ImageLightbox
                key={attachment.id}
                src={attachment.url ?? ""}
                alt={attachment.name ?? alt}
              >
                <div
                  className={cn(
                    "relative cursor-zoom-in overflow-hidden rounded-xl border shadow-sm group",
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
        ) : null}

        {fileAttachments.length ? (
          <div className="space-y-2">
            {fileAttachments.map((attachment) => (
              <div
                key={attachment.id}
                className={cn(
                  "flex items-center gap-3 rounded-xl border px-3 py-2 text-[12px] shadow-sm",
                  variant === "user"
                    ? "chat-user-attachment-card"
                    : "border-white/10 bg-muted/40 text-foreground"
                )}
              >
                <div
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-current",
                    variant === "user" ? "bg-black/6 dark:bg-white/10" : "bg-black/10"
                  )}
                >
                  <FileText className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">
                    {attachment.name ?? attachment.fileId ?? "File"}
                  </div>
                  <div className="truncate opacity-80 text-[11px]">
                    {typeof attachment.size === "number"
                      ? formatFileSize(attachment.size)
                      : attachment.type || attachment.fileId || ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : null}
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
          att.name === nextProps.attachments[idx]?.name &&
          att.fileId === nextProps.attachments[idx]?.fileId &&
          att.kind === nextProps.attachments[idx]?.kind
      )

    // variant 未变化
    const variantUnchanged = prevProps.variant === nextProps.variant

    // alt 未变化
    const altUnchanged = prevProps.alt === nextProps.alt

    return attachmentsUnchanged && variantUnchanged && altUnchanged
  }
)

MessageAttachments.displayName = "MessageAttachments"
