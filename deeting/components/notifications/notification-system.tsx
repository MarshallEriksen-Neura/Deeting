"use client"

import { useCallback, useEffect, useRef } from "react"
import { listen, UnlistenFn } from "@tauri-apps/api/event"
import { useTranslations } from "next-intl"
import { GlassPillToaster } from "@/components/ui/glass-pill-toaster"
import { NotificationCenter } from "@/components/notifications/notification-center"
import { AmbientIndicator } from "@/components/ui/ambient-indicator"
import { useNotifications } from "@/components/contexts/notification-context"
import { useNotificationRealtime } from "@/components/notifications/use-notification-realtime"
import { useRouter } from "@/i18n/routing"
import {
  MODEL_CONFIG_REQUIRED_EVENT,
  type MissingDesktopModelConfig,
  type ModelConfigRequiredDetail,
} from "@/lib/model-config-required"
import { useAuthStore } from "@/store/auth-store"

interface NotificationSystemProps {
  // 环境光指示器目标元素ID
  ambientTargetId?: string
}

export function NotificationSystem({ 
  ambientTargetId
}: NotificationSystemProps) {
  const router = useRouter()
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const { 
    notifications, 
    trimNotifications,
    processingState,
    addNotification,
  } = useNotifications()
  const { sendMarkRead, sendMarkAllRead, sendClear } = useNotificationRealtime()
  const t = useTranslations("notifications")
  const lastModelConfigPromptRef = useRef<{ key: string; at: number } | null>(null)

  const openModelConfigGuard = useCallback(
    (nextMissing: MissingDesktopModelConfig[]) => {
      if (!isAuthenticated) return
      if (nextMissing.length === 0) return

      const missingKey = [...nextMissing].sort().join(",")
      const now = Date.now()
      const previous = lastModelConfigPromptRef.current
      if (previous && previous.key === missingKey && now - previous.at < 5000) {
        return
      }
      lastModelConfigPromptRef.current = { key: missingKey, at: now }

      const separator = t("events.modelConfigRequired.separator")
      const items = nextMissing
        .map((key) => t(`events.modelConfigRequired.requirements.${key}`))
        .join(separator)

      addNotification({
        type: "warning",
        title: t("events.modelConfigRequired.title"),
        description: t("events.modelConfigRequired.description", { items }),
        timestamp: now,
        action: {
          label: t("actions.goSettings"),
          onClick: () => router.push("/settings"),
        },
      })
    },
    [addNotification, isAuthenticated, router, t]
  )

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

  useEffect(() => {
    if (typeof window === "undefined") return
    const handleModelConfigRequired = (event: Event) => {
      if (!isAuthenticated) return
      const detail = (event as CustomEvent<ModelConfigRequiredDetail>).detail
      const missing = detail?.missing ?? []
      if (!Array.isArray(missing) || missing.length === 0) return
      openModelConfigGuard(missing)
    }

    window.addEventListener(
      MODEL_CONFIG_REQUIRED_EVENT,
      handleModelConfigRequired as EventListener
    )
    return () => {
      window.removeEventListener(
        MODEL_CONFIG_REQUIRED_EVENT,
        handleModelConfigRequired as EventListener
      )
    }
  }, [isAuthenticated, openModelConfigGuard])

  const targetElement: HTMLElement | undefined = ambientTargetId
    ? document.getElementById(ambientTargetId) || undefined
    : undefined

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
