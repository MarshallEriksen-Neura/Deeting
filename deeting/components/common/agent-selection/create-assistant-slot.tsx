"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { CreateAgentModal } from "@/components/assistants/create-agent-modal"

/**
 * CreateAssistantSlot Component
 * 
 * 创建助手槽位组件，用于在路由 `/chat/create/assistant` 时显示创建助手的模态框。
 * 
 * 功能：
 * - 自动打开创建助手模态框
 * - 创建成功后跳转到新助手的聊天页面
 * - 关闭模态框后返回聊天首页
 * 
 * 性能优化：
 * - 使用 useCallback 缓存事件处理函数
 */
export default function CreateAssistantSlot() {
  const router = useRouter()
  const [open, setOpen] = React.useState(true)
  const isTauri = process.env.NEXT_PUBLIC_IS_TAURI === "true"

  // 使用 useCallback 缓存事件处理函数
  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen)
      if (!nextOpen) {
        router.replace("/chat")
      }
    },
    [router]
  )

  const handleCreated = React.useCallback(
    (assistantId?: string) => {
      if (assistantId) {
        router.replace(`/chat/${encodeURIComponent(assistantId)}`)
      } else {
        router.replace("/chat")
      }
    },
    [router]
  )

  return (
    <CreateAgentModal
      mode={isTauri ? "local" : "cloud"}
      open={open}
      onOpenChange={handleOpenChange}
      onCreated={handleCreated}
      trigger={null}
    />
  )
}
