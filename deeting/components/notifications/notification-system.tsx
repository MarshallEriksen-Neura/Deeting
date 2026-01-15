"use client"

import { useEffect } from "react"
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
    processingState 
  } = useNotifications()
  const { sendMarkRead, sendMarkAllRead, sendClear } = useNotificationRealtime()

  // 自动清理旧通知（保留最近50条）
  useEffect(() => {
    trimNotifications(50)
  }, [notifications, trimNotifications])

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
