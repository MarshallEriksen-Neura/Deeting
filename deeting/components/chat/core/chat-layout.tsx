"use client"

import * as React from "react"
import { Bot } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/hooks/use-i18n"
import { useRouter } from "next/navigation"
import type { ChatAssistant } from "@/store/chat-state-store"

interface ChatLayoutProps {
  children: React.ReactNode
  agent?: ChatAssistant
  isLoadingAssistants?: boolean
  allowMissingAgent?: boolean
}

/**
 * ChatLayout 组件
 * 
 * 负责聊天界面的整体布局结构，包括：
 * - 加载状态展示
 * - 错误状态展示（代理不存在）
 * - 正常聊天布局
 * 
 * 性能优化：
 * - 使用 React.memo 避免不必要的重渲染
 * - 使用 useCallback 缓存事件处理函数
 * 
 * @param children - 子组件（聊天内容）
 * @param agent - 当前聊天代理
 * @param isLoadingAssistants - 是否正在加载代理列表
 * 
 * @example
 * ```tsx
 * <ChatLayout agent={agent} isLoadingAssistants={isLoading}>
 *   <ChatContent />
 * </ChatLayout>
 * ```
 */
export const ChatLayout = React.memo<ChatLayoutProps>(function ChatLayout({
  children,
  agent,
  isLoadingAssistants,
  allowMissingAgent,
}) {
  const t = useI18n("chat")
  const router = useRouter()

  // 使用 useCallback 缓存事件处理函数
  const handleBackToList = React.useCallback(() => {
    router.push("/chat")
  }, [router])

  // 加载状态
  if (!agent && isLoadingAssistants) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-60px)] space-y-4">
        <div className="bg-muted p-4 rounded-full">
          <Bot className="w-8 h-8 text-muted-foreground" />
        </div>
        <p className="text-muted-foreground">{t("empty.loading")}</p>
      </div>
    )
  }

  // 代理不存在
  if (!agent) {
    if (allowMissingAgent) {
      return <>{children}</>
    }
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-60px)] space-y-4">
        <div className="bg-muted p-4 rounded-full">
          <Bot className="w-8 h-8 text-muted-foreground" />
        </div>
        <h1 className="text-xl font-bold">{t("empty.notFoundTitle")}</h1>
        <p className="text-muted-foreground">{t("empty.notFoundDesc")}</p>
        <Button onClick={handleBackToList}>
          {t("empty.backToList")}
        </Button>
      </div>
    )
  }

  // 正常聊天布局
  return (
    <div className="flex flex-col h-[calc(100vh-60px)] min-h-0 overflow-hidden bg-transparent">
      {children}
    </div>
  )
})
