"use client"

import { useEffect } from "react"
import { listen, UnlistenFn } from "@tauri-apps/api/event"
import { useTranslations } from "next-intl"
import { GlassPillToaster } from "@/components/ui/glass-pill-toaster"
import { NotificationCenter } from "@/components/notifications/notification-center"
import { AmbientIndicator } from "@/components/ui/ambient-indicator"
import { useNotifications } from "@/components/contexts/notification-context"
import { useNotificationRealtime } from "@/components/notifications/use-notification-realtime"

interface NotificationSystemProps {
  // 环境光指示器目标元素ID
  ambientTargetId?: string
}

export function NotificationSystem({ 
  ambientTargetId
}: NotificationSystemProps) {
  const { 
    notifications, 
    trimNotifications,
    processingState,
    addNotification,
  } = useNotifications()
  const { sendMarkRead, sendMarkAllRead, sendClear } = useNotificationRealtime()
  const t = useTranslations("notifications")

  // 自动清理旧通知（保留最近50条）
  useEffect(() => {
    trimNotifications(50)
  }, [notifications, trimNotifications])

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_IS_TAURI !== "true") return
    let unlisten: UnlistenFn | null = null
    listen<{ tool_id: string; tool_name: string; message: string }>("mcp-supervisor", (event) => {
      const payload = event.payload
      addNotification({
        type: "error",
        title: t("events.mcpCrashed", { name: payload.tool_name || payload.tool_id }),
        description: t("events.mcpCrashedDesc", { error: payload.message }),
        timestamp: Date.now(),
      })
    }).then((stop) => {
      unlisten = stop
    })
    return () => {
      if (unlisten) {
        unlisten()
      }
    }
  }, [addNotification, t])

  const targetElement = ambientTargetId ? document.getElementById(ambientTargetId) : undefined

  return (
    <>
      {/* 瞬态通知：Glass Pill */}
      <GlassPillToaster />
      
      {/* 环境光指示器 */}
      {processingState.isProcessing && (
        <AmbientIndicator
          state="processing"
          message={processingState.message}
          targetElement={targetElement}
        />
      )}
      
      {/* 持久通知中心 - 现在通过Zustand控制，不需要传props */}
      <NotificationCenter
        onMarkRead={sendMarkRead}
        onMarkAllRead={sendMarkAllRead}
        onClear={sendClear}
      />
    </>
  )
}
