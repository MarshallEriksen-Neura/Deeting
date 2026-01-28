"use client"

import * as React from "react"
import { ArrowDown, ArrowUp } from "lucide-react"
import { Virtuoso, VirtuosoHandle } from "react-virtuoso"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { MessageItem } from "./message-item"
import { AIResponseBubble } from "./ai-response-bubble"
import type { Message, ChatAssistant } from "@/store/chat-state-store"
import { useI18n } from "@/hooks/use-i18n"

interface ChatMessageListProps {
  messages: Message[]
  agent: ChatAssistant
  isTyping: boolean
  streamEnabled: boolean
  statusStage: string | null
  statusCode: string | null
  statusMeta: Record<string, unknown> | null
}

/**
 * ChatMessageList 组件 - 消息列表展示
 * 
 * 功能特性：
 * - 当消息数量 > 50 时启用虚拟滚动（react-virtuoso）
 * - 当消息数量 <= 50 时使用普通滚动（ScrollArea）
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
  streamEnabled,
  statusStage,
  statusCode,
  statusMeta,
}: ChatMessageListProps) {
  const t = useI18n("chat")
  const virtuosoRef = React.useRef<VirtuosoHandle>(null)
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const scrollAreaRef = React.useRef<HTMLDivElement>(null)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const [showScrollToBottom, setShowScrollToBottom] = React.useState(false)
  const [showScrollToTop, setShowScrollToTop] = React.useState(false)
  const [autoScrollEnabled, setAutoScrollEnabled] = React.useState(true)

  // 计算最后一条助手消息的 ID
  const lastAssistantId = React.useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]?.role === "assistant") return messages[i]?.id
    }
    return undefined
  }, [messages])

  // 判断是否启用虚拟滚动（消息数量 > 50）
  const useVirtualScroll = messages.length > 50

  // 根据 HUD/Controls 高度为消息列表预留空间
  React.useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const hud = document.querySelector<HTMLElement>('[data-chat-hud]')
    const controls = document.querySelector<HTMLElement>('[data-chat-controls]')
    const fallbackTop = 112
    const fallbackBottom = 152

    const updateOffsets = () => {
      const hudHeight = hud?.getBoundingClientRect().height ?? 0
      const controlsHeight = controls?.getBoundingClientRect().height ?? 0
      const topOffset = Math.max(hudHeight + 24, fallbackTop)
      const bottomOffset = Math.max(controlsHeight + 24, fallbackBottom)
      container.style.setProperty("--chat-hud-offset", `${topOffset}px`)
      container.style.setProperty("--chat-controls-offset", `${bottomOffset}px`)
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
      paddingTop: "calc(var(--chat-hud-offset, 112px) + env(safe-area-inset-top) + 16px)",
      paddingBottom:
        "calc(var(--chat-controls-offset, 152px) + env(safe-area-inset-bottom) + 32px)",
    }),
    []
  )

  // 自动滚动到底部（普通滚动模式）
  React.useEffect(() => {
    if (useVirtualScroll || !autoScrollEnabled) return
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [messages, isTyping, autoScrollEnabled, useVirtualScroll])

  // 自动滚动到底部（虚拟滚动模式）
  React.useEffect(() => {
    if (!useVirtualScroll || !autoScrollEnabled) return
    virtuosoRef.current?.scrollToIndex({
      index: messages.length - 1,
      behavior: "smooth",
      align: "end",
    })
  }, [messages, isTyping, autoScrollEnabled, useVirtualScroll])

  // 获取滚动视口（普通滚动模式）
  const getViewport = React.useCallback(() => {
    return (
      scrollAreaRef.current?.querySelector<HTMLElement>(
        '[data-slot="scroll-area-viewport"]'
      ) ?? null
    )
  }, [])

  // 监听滚动事件（普通滚动模式）
  React.useEffect(() => {
    if (useVirtualScroll) return

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
  }, [getViewport, useVirtualScroll])

  // 初始化滚动按钮状态（普通滚动模式）
  React.useEffect(() => {
    if (useVirtualScroll) return

    const viewport = getViewport()
    if (!viewport) return

    const { scrollTop, scrollHeight, clientHeight } = viewport
    const distanceToBottom = scrollHeight - (scrollTop + clientHeight)
    const nearBottom = distanceToBottom < 120
    setShowScrollToBottom(!nearBottom)
    setShowScrollToTop(scrollTop > 120)
    setAutoScrollEnabled(nearBottom)
  }, [messages, isTyping, getViewport, useVirtualScroll])

  // 滚动到顶部
  const scrollToTop = React.useCallback(() => {
    if (useVirtualScroll) {
      virtuosoRef.current?.scrollToIndex({
        index: 0,
        behavior: "smooth",
        align: "start",
      })
    } else {
      const viewport = getViewport()
      viewport?.scrollTo({ top: 0, behavior: "smooth" })
    }
  }, [useVirtualScroll, getViewport])

  // 滚动到底部
  const scrollToBottom = React.useCallback(() => {
    setAutoScrollEnabled(true)
    if (useVirtualScroll) {
      virtuosoRef.current?.scrollToIndex({
        index: messages.length - 1,
        behavior: "smooth",
        align: "end",
      })
    } else {
      scrollRef.current?.scrollIntoView({ behavior: "smooth" })
    }
  }, [useVirtualScroll, messages.length])

  // 渲染单条消息
  const renderMessage = React.useCallback(
    (index: number) => {
      const msg = messages[index]
      if (!msg) return null

      return (
        <MessageItem
          key={msg.id}
          message={msg}
          agent={agent}
          isActive={msg.id === lastAssistantId && isTyping}
          streamEnabled={streamEnabled}
          statusStage={msg.id === lastAssistantId ? statusStage : null}
          statusCode={msg.id === lastAssistantId ? statusCode : null}
          statusMeta={msg.id === lastAssistantId ? statusMeta : null}
          lastAssistantId={lastAssistantId}
          isTyping={isTyping}
        />
      )
    },
    [
      messages,
      agent,
      lastAssistantId,
      isTyping,
      streamEnabled,
      statusStage,
      statusCode,
      statusMeta,
    ]
  )

  // 渲染正在输入的占位符
  const renderTypingIndicator = () => {
    if (!isTyping || lastAssistantId) return null

    return (
      <div className="flex gap-3">
        <Avatar className="w-8 h-8 border shadow-sm">
          <AvatarImage
            src={`https://api.dicebear.com/7.x/bottts/svg?seed=${agent.name}`}
          />
          <AvatarFallback>AI</AvatarFallback>
        </Avatar>
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
  }

  return (
    <div ref={containerRef} className="relative flex-1 min-h-0 overflow-hidden">
      {useVirtualScroll ? (
        // 虚拟滚动模式（消息数量 > 50）
        <Virtuoso
          ref={virtuosoRef}
          data={messages}
          itemContent={renderMessage}
          followOutput="smooth"
          alignToBottom
          className="h-full"
          style={{ height: "100%" }}
          components={{
            List: React.forwardRef(({ children, ...props }, ref) => (
              <div
                ref={ref}
                {...props}
                className="max-w-5xl 2xl:max-w-6xl mx-auto space-y-6 px-4"
                style={listPaddingStyle}
              >
                {children}
              </div>
            )),
            Footer: () => (
              <>
                {renderTypingIndicator()}
                <div style={{ height: "1px" }} />
              </>
            ),
          }}
          rangeChanged={(range) => {
            // 更新滚动按钮状态
            if (range.endIndex >= messages.length - 2) {
              setShowScrollToBottom(false)
              setAutoScrollEnabled(true)
            } else {
              setShowScrollToBottom(true)
              setAutoScrollEnabled(false)
            }
            setShowScrollToTop(range.startIndex > 2)
          }}
        />
      ) : (
        // 普通滚动模式（消息数量 <= 50）
        <div ref={scrollAreaRef} className="h-full min-h-0">
          <ScrollArea className="h-full">
            <div
              className="max-w-5xl 2xl:max-w-6xl mx-auto space-y-6 px-4"
              style={listPaddingStyle}
            >
              {messages.map((msg, index) => renderMessage(index))}
              {renderTypingIndicator()}
              <div ref={scrollRef} />
            </div>
          </ScrollArea>
        </div>
      )}

      {/* 滚动按钮 */}
      <div className="pointer-events-none absolute bottom-4 right-4 flex flex-col gap-2">
        {showScrollToTop && (
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
        {showScrollToBottom && (
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
    </div>
  )
}
