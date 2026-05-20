"use client"

import * as React from "react"
import { ArrowDown, ArrowUp } from "lucide-react"
import { createPortal } from "react-dom"
import { Virtuoso, VirtuosoHandle } from "react-virtuoso"
import { Button } from "@/ui/shadcn/button"
import { MessageItem } from "./message-item"
import { AIResponseBubble } from "./ai-response-bubble"
import { cn } from "@/lib/utils"
import type { Message, ChatAssistant } from "@/store/chat-store"
import { useI18n } from "@/hooks/use-i18n"
import { deriveAssistantActivityState } from "@/lib/chat/assistant-activity"

function getPersistedKnowledgeContextStatus(message: Message) {
  const status = message.metaInfo?.knowledge_context_status
  if (!status || typeof status !== "object" || Array.isArray(status)) {
    return null
  }
  const record = status as Record<string, unknown>
  if (record.code !== "knowledge.context.loaded") {
    return null
  }
  const meta = record.meta
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    return null
  }
  return {
    statusCode: record.code,
    statusMeta: meta as Record<string, unknown>,
  }
}

function isWorkflowAssistantMessage(message: Message) {
  if (message.role !== "assistant") return false
  if (
    message.metaInfo?.workflow_live ||
    message.metaInfo?.workflow_plan ||
    message.metaInfo?.workflow_receipt
  ) {
    return true
  }
  return Boolean(
    message.blocks?.some(
      (block) => block.type === "ui" && block.viewType.startsWith("workflow.")
    )
  )
}

interface ChatMessageListProps {
  messages: Message[]
  agent?: ChatAssistant
  isTyping: boolean
  statusMessageId?: string | null
  streamEnabled: boolean
  statusStage: string | null
  statusCode: string | null
  statusMeta: Record<string, unknown> | null
  onRegenerate?: (messageId: string) => void
  onLike?: (messageId: string) => void
  onDislike?: (messageId: string) => void
  onCompareWithModel?: (messageId: string, modelValue: string) => void
  onFinalizeCompare?: (messageId: string, modelKey: string) => void
}

// ============== Virtuoso 自定义组件（必须在组件外部定义）==============

interface VirtuosoListProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode
}

const VirtuosoList = React.forwardRef<HTMLDivElement, VirtuosoListProps>(
  ({ children, style, ...props }, ref) => (
    <div
      ref={ref}
      {...props}
      className="max-w-5xl 2xl:max-w-6xl mx-auto space-y-6 px-4"
      style={{
        ...style,
        paddingTop: "calc(env(safe-area-inset-top) + 16px)",
        paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)",
      }}
    >
      {children}
    </div>
  )
)
VirtuosoList.displayName = "VirtuosoList"

/**
 * ChatMessageList 组件 - 消息列表展示
 *
 * 功能特性：
 * - 当消息数量 > 50 时启用虚拟滚动（react-virtuoso）
 * - 当消息数量 <= 50 时使用普通滚动
 * - 自动滚动到底部（新消息到达时）
 * - 滚动位置保持（用户向上滚动查看历史时）
 * - 使用 MessageItem 组件渲染单条消息
 * - 支持滚动到顶部/底部按钮
 *
 * Requirements: 4.1, 4.3, 4.4, 4.5
 */
export function ChatMessageList({
  messages,
  agent,
  isTyping,
  statusMessageId,
  streamEnabled,
  statusStage,
  statusCode,
  statusMeta,
  onRegenerate,
  onLike,
  onDislike,
  onCompareWithModel,
  onFinalizeCompare,
}: ChatMessageListProps) {
  const t = useI18n("chat")
  const virtuosoRef = React.useRef<VirtuosoHandle>(null)
  const scrollEndRef = React.useRef<HTMLDivElement>(null)
  const scrollContainerRef = React.useRef<HTMLElement | null>(null)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const [scrollParent, setScrollParent] = React.useState<HTMLElement | null>(null)
  const [scrollControlsHost, setScrollControlsHost] = React.useState<HTMLElement | null>(null)

  // 使用 ref 存储滚动状态，避免 setState 触发重渲染循环
  const scrollStateRef = React.useRef({
    showBottom: false,
    showTop: false,
    autoScroll: true,
  })

  // 只在需要更新 UI 时才使用 state
  const [scrollButtons, setScrollButtons] = React.useState({ showTop: false, showBottom: false })
  const autoScrollEnabledRef = React.useRef(true)

  // 计算最后一条助手消息的 ID
  const lastAssistantId = React.useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i]
      if (message?.role === "assistant" && !isWorkflowAssistantMessage(message)) {
        return message.id
      }
    }
    return undefined
  }, [messages])

  // 判断是否启用虚拟滚动（消息数量 > 50）
  const useVirtualScroll = messages.length > 50

  // 根据 HUD/Controls 高度为消息列表预留空间
  React.useEffect(() => {
    const container = containerRef.current
    const root = typeof document !== "undefined" ? document.documentElement : null
    if (!container) return

    const hud = document.querySelector<HTMLElement>('[data-chat-hud]')
    const controls = document.querySelector<HTMLElement>('[data-chat-controls]')
    const fallbackTop = 112
    const fallbackBottom = 96

    const updateOffsets = () => {
      const hudRect = hud?.getBoundingClientRect()
      const controlsRect = controls?.getBoundingClientRect()
      const topOffset = Math.max((hudRect?.bottom ?? 0) + 16, fallbackTop)
      const bottomOffset = Math.max(
        controlsRect ? window.innerHeight - controlsRect.top : fallbackBottom,
        fallbackBottom
      )
      container.style.setProperty("--chat-hud-offset", `${topOffset}px`)
      container.style.setProperty("--chat-controls-offset", `${bottomOffset}px`)
      root?.style.setProperty("--chat-hud-offset", `${topOffset}px`)
      root?.style.setProperty("--chat-controls-offset", `${bottomOffset}px`)
    }

    updateOffsets()

    const observers: ResizeObserver[] = []
    if (hud) {
      const observer = new ResizeObserver(updateOffsets)
      observer.observe(hud)
      observers.push(observer)
    }
    if (controls) {
      const observer = new ResizeObserver(updateOffsets)
      observer.observe(controls)
      observers.push(observer)
    }

    window.addEventListener("resize", updateOffsets)

    return () => {
      observers.forEach((observer) => observer.disconnect())
      window.removeEventListener("resize", updateOffsets)
    }
  }, [])

  const listPaddingStyle = React.useMemo(
    () => ({
      paddingTop: "calc(env(safe-area-inset-top) + 16px)",
      paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)",
    }),
    []
  )

  React.useEffect(() => {
    if (typeof document === "undefined") return
    const layoutScrollParent = document.querySelector<HTMLElement>("[data-chat-scroll]")
    const parent = useVirtualScroll
      ? layoutScrollParent
      : containerRef.current
    if (!parent) return
    scrollContainerRef.current = parent
    setScrollParent(parent)
    setScrollControlsHost(layoutScrollParent ?? parent)
  }, [useVirtualScroll])

  // 自动滚动到底部（普通滚动模式）
  React.useEffect(() => {
    if (useVirtualScroll || !autoScrollEnabledRef.current) return
    scrollEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages.length, isTyping, useVirtualScroll])

  // 自动滚动到底部（虚拟滚动模式）
  React.useEffect(() => {
    if (!useVirtualScroll || !autoScrollEnabledRef.current) return
    virtuosoRef.current?.scrollToIndex({
      index: messages.length - 1,
      behavior: "smooth",
      align: "end",
    })
  }, [messages.length, isTyping, useVirtualScroll])

  // 更新滚动按钮状态（使用 ref 比较避免不必要的 setState）
  const updateScrollButtons = React.useCallback((showTop: boolean, showBottom: boolean, nearBottom: boolean) => {
    const prev = scrollStateRef.current
    if (prev.showTop !== showTop || prev.showBottom !== showBottom) {
      scrollStateRef.current = { showTop, showBottom, autoScroll: nearBottom }
      setScrollButtons({ showTop, showBottom })
    }
    autoScrollEnabledRef.current = nearBottom
  }, [])

  // 监听滚动事件（普通滚动模式）
  React.useEffect(() => {
    if (useVirtualScroll || !scrollParent) return
    const container = scrollParent

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container
      const distanceToBottom = scrollHeight - (scrollTop + clientHeight)
      const nearBottom = distanceToBottom < 120
      updateScrollButtons(scrollTop > 120, !nearBottom, nearBottom)
    }

    // 初始检查
    handleScroll()
    container.addEventListener("scroll", handleScroll, { passive: true })
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => handleScroll())

    resizeObserver?.observe(container)
    if (container.firstElementChild instanceof HTMLElement) {
      resizeObserver?.observe(container.firstElementChild)
    }

    return () => {
      container.removeEventListener("scroll", handleScroll)
      resizeObserver?.disconnect()
    }
  }, [useVirtualScroll, scrollParent, updateScrollButtons, messages.length, isTyping])

  // 滚动到顶部
  const scrollToTop = React.useCallback(() => {
    if (useVirtualScroll) {
      virtuosoRef.current?.scrollToIndex({
        index: 0,
        behavior: "smooth",
        align: "start",
      })
    } else {
      scrollParent?.scrollTo({ top: 0, behavior: "smooth" })
    }
  }, [useVirtualScroll, scrollParent])

  // 滚动到底部
  const scrollToBottom = React.useCallback(() => {
    autoScrollEnabledRef.current = true
    if (useVirtualScroll) {
      virtuosoRef.current?.scrollToIndex({
        index: messages.length - 1,
        behavior: "smooth",
        align: "end",
      })
    } else {
      scrollEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }
  }, [useVirtualScroll, messages.length])

  // Virtuoso rangeChanged 处理（使用 ref 避免循环）
  const handleRangeChanged = React.useCallback((range: { startIndex: number; endIndex: number }) => {
    const nearBottom = range.endIndex >= messages.length - 2
    updateScrollButtons(range.startIndex > 2, !nearBottom, nearBottom)
  }, [messages.length, updateScrollButtons])

  // 渲染单条消息
  const renderMessage = React.useCallback(
    (index: number) => {
      const msg = messages[index]
      if (!msg) return null
      const embeddedActivity =
        msg.role === "assistant"
          ? deriveAssistantActivityState(msg.blocks)
          : { isActive: false, statusStage: null, statusCode: null, statusMeta: null }
      const activeStatusMessageId =
        typeof statusMessageId === "string" && statusMessageId.trim().length > 0
          ? statusMessageId.trim()
          : lastAssistantId
      const isStreamedActive = msg.id === activeStatusMessageId && isTyping
      const isMessageActive = isStreamedActive || embeddedActivity.isActive
      const persistedKnowledgeStatus =
        msg.role === "assistant" ? getPersistedKnowledgeContextStatus(msg) : null
      const effectiveStatusStage = isStreamedActive
        ? msg.id === activeStatusMessageId
          ? statusStage
          : null
        : embeddedActivity.statusStage
      const effectiveStatusCode = isStreamedActive
        ? msg.id === activeStatusMessageId
          ? statusCode
          : null
        : embeddedActivity.statusCode ?? persistedKnowledgeStatus?.statusCode ?? null
      const effectiveStatusMeta = isStreamedActive
        ? msg.id === activeStatusMessageId
          ? statusMeta
          : null
        : embeddedActivity.statusMeta ?? persistedKnowledgeStatus?.statusMeta ?? null

      return (
        <MessageItem
          key={msg.id}
          message={msg}
          agent={agent}
          isActive={isMessageActive}
          streamEnabled={streamEnabled}
          statusStage={effectiveStatusStage}
          statusCode={effectiveStatusCode}
          statusMeta={effectiveStatusMeta}
          lastAssistantId={lastAssistantId}
          isTyping={isTyping}
          onRegenerate={onRegenerate}
          onLike={onLike}
          onDislike={onDislike}
          onCompareWithModel={onCompareWithModel}
          onFinalizeCompare={onFinalizeCompare}
        />
      )
    },
    [
      messages,
      agent,
      lastAssistantId,
      statusMessageId,
      isTyping,
      streamEnabled,
      statusStage,
      statusCode,
      statusMeta,
      onRegenerate,
      onLike,
      onDislike,
      onCompareWithModel,
      onFinalizeCompare,
    ]
  )

  // 渲染正在输入的占位符
  const renderTypingIndicator = React.useCallback(() => {
    if (!isTyping || lastAssistantId) return null

    return (
      <div className="flex">
        <div className="flex-1 min-w-0">
          <AIResponseBubble
            parts={[]}
            isActive={true}
            streamEnabled={streamEnabled}
            typingEnabled={false}
            statusStage={statusStage}
            statusCode={statusCode}
            statusMeta={statusMeta}
          />
        </div>
      </div>
    )
  }, [isTyping, lastAssistantId, streamEnabled, statusStage, statusCode, statusMeta])

  // Virtuoso Footer 组件
  const VirtuosoFooter = React.useCallback(() => (
    <>
      {renderTypingIndicator()}
      <div style={{ height: "1px" }} />
    </>
  ), [renderTypingIndicator])

  const scrollControls =
    scrollButtons.showTop || scrollButtons.showBottom ? (
      <div className="pointer-events-none absolute bottom-4 right-4 z-20 flex flex-col gap-2">
        {scrollButtons.showTop && (
          <Button
            variant="secondary"
            size="icon"
            className="pointer-events-auto h-9 w-9 rounded-full shadow-md"
            aria-label={t("scroll.toTop")}
            onClick={scrollToTop}
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
        )}
        {scrollButtons.showBottom && (
          <Button
            variant="secondary"
            size="icon"
            className="pointer-events-auto h-9 w-9 rounded-full shadow-md"
            aria-label={t("scroll.toBottom")}
            onClick={scrollToBottom}
          >
            <ArrowDown className="h-4 w-4" />
          </Button>
        )}
      </div>
    ) : null

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative flex-1 min-h-0 h-full w-full",
        useVirtualScroll ? "overflow-hidden" : "overflow-y-auto overflow-x-hidden"
      )}
    >
      {useVirtualScroll ? (
        // 虚拟滚动模式（消息数量 > 50）
        <Virtuoso
          ref={virtuosoRef}
          data={messages}
          itemContent={renderMessage}
          followOutput="smooth"
          alignToBottom
          customScrollParent={scrollParent ?? undefined}
          className="h-full"
          style={{ height: "100%" }}
          components={{
            List: VirtuosoList,
            Footer: VirtuosoFooter,
          }}
          rangeChanged={handleRangeChanged}
        />
      ) : (
        // 普通滚动模式（消息数量 <= 50）- 使用原生 div 避免 ScrollArea ref 问题
        <div className="min-h-full overflow-x-hidden">
          <div
            className="max-w-5xl 2xl:max-w-6xl mx-auto grid min-h-full auto-rows-max content-end gap-6 px-4"
            style={listPaddingStyle}
          >
            {messages.map((_, index) => renderMessage(index))}
            {renderTypingIndicator()}
            <div ref={scrollEndRef} />
          </div>
        </div>
      )}

      {/* 滚动按钮 */}
      {!scrollControlsHost && scrollControls}
      {scrollControlsHost ? createPortal(scrollControls, scrollControlsHost) : null}
    </div>
  )
}
