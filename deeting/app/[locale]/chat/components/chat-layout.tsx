"use client"

import * as React from "react"
import { Bot } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/hooks/use-i18n"
import { useRouter } from "next/navigation"
import type { ChatAssistant } from "@/store/chat-store"

interface ChatLayoutProps {
  children: React.ReactNode
  agent?: ChatAssistant
  isLoadingAssistants?: boolean
}

export function ChatLayout({ children, agent, isLoadingAssistants }: ChatLayoutProps) {
  const t = useI18n("chat")
  const router = useRouter()

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
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-60px)] space-y-4">
        <div className="bg-muted p-4 rounded-full">
          <Bot className="w-8 h-8 text-muted-foreground" />
        </div>
        <h1 className="text-xl font-bold">{t("empty.notFoundTitle")}</h1>
        <p className="text-muted-foreground">{t("empty.notFoundDesc")}</p>
        <Button onClick={() => router.push("/chat")}>
          {t("empty.backToList")}
        </Button>
      </div>
    )
  }

  // 正常聊天布局
  return (
    <div className="flex flex-col h-[calc(100vh-60px)] bg-background">
      {children}
    </div>
  )
}