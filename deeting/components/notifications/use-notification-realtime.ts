"use client"

import { useCallback, useEffect, useMemo, useRef } from "react"

import { buildApiWsUrl, getAuthToken, refreshAccessToken } from "@/lib/http/client"
import { startLocalMonitorWorker, stopLocalMonitorWorker } from "@/lib/api/monitors"
import { useNotificationActions } from "@/stores/notification-store"
import { useAuthStore } from "@/store/auth-store"
import { type NotificationItem, type NotificationType } from "@/components/notifications/notification-center"
import {
  markNotificationRead,
  markAllNotificationsRead,
  clearAllNotifications,
} from "@/lib/api/notifications"

type BackendNotificationLevel = "info" | "warn" | "error" | "critical"

interface BackendNotificationItem {
  id: string
  notification_id?: string
  title: string
  content: string
  type?: string
  level?: BackendNotificationLevel
  payload?: Record<string, unknown>
  source?: string | null
  created_at?: string
  read?: boolean
  read_at?: string | null
}

interface NotificationSnapshotPayload {
  items?: BackendNotificationItem[]
  unread_count?: number
}

interface NotificationPushPayload {
  item?: BackendNotificationItem
  unread_count?: number
}

interface NotificationMessage {
  type: "snapshot" | "notification" | "ack" | "pong" | "error"
  data?: NotificationSnapshotPayload | NotificationPushPayload | Record<string, unknown>
}

interface RealtimeOptions {
  enabled?: boolean
}

const POLL_RECONNECT_BASE_MS = 1000
const POLL_RECONNECT_MAX_MS = 30000
const PING_INTERVAL_MS = 25000



function mapLevelToUiType(level?: string): NotificationType {
  switch (level) {
    case "warn":
      return "warning"
    case "error":
    case "critical":
      return "error"
    default:
      return "info"
  }
}

function mapBackendItem(item: BackendNotificationItem): NotificationItem | null {
  if (!item?.id || !item?.title) return null

  const reason = typeof item.payload?.reason === "string"
    ? item.payload.reason.trim()
    : undefined

  return {
    id: String(item.id),
    type: mapLevelToUiType(item.level),
    title: String(item.title),
    description: String(item.content ?? ""),
    timestamp: item.created_at ?? new Date().toISOString(),
    read: Boolean(item.read ?? item.read_at),
    meta: reason ? { reason } : undefined,
  }
}

function safeParseMessage(raw: string): NotificationMessage | null {
  try {
    return JSON.parse(raw) as NotificationMessage
  } catch {
    return null
  }
}

let taskProgressCallback: ((task: any) => void) | null = null

export function setTaskProgressCallback(callback: (task: any) => void) {
  taskProgressCallback = callback
}

export function useNotificationRealtime(options: RealtimeOptions = {}) {
  const { enabled = true } = options
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const {
    setList,
    upsert,
    setUnreadCount,
    markAsRead: storeMarkAsRead,
    markAllAsRead: storeMarkAllAsRead,
    clear: storeClear,
  } = useNotificationActions()

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<number | null>(null)
  const pingTimerRef = useRef<number | null>(null)
  const reconnectAttemptRef = useRef(0)
  const activeRef = useRef(false)

  const send = useCallback((payload: Record<string, unknown>) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return false
    }
    ws.send(JSON.stringify(payload))
    return true
  }, [])

  const sendMarkRead = useCallback(
    (notificationId: string) => {
      // 1. 立即更新本地状态
      storeMarkAsRead(notificationId)
      // 2. 通过 HTTP API 持久化到后端
      markNotificationRead(notificationId)
        .then((res) => {
          setUnreadCount(res.unread_count)
        })
        .catch(() => {
          // HTTP 失败时尝试 WebSocket 作为降级
          send({ type: "mark_read", notification_id: notificationId })
        })
    },
    [send, storeMarkAsRead, setUnreadCount]
  )

  const sendMarkAllRead = useCallback(() => {
    // 1. 立即更新本地状态
    storeMarkAllAsRead()
    // 2. 通过 HTTP API 持久化到后端
    markAllNotificationsRead()
      .then((res) => {
        setUnreadCount(res.unread_count)
      })
      .catch(() => {
        send({ type: "mark_all_read" })
      })
  }, [send, storeMarkAllAsRead, setUnreadCount])

  const sendClear = useCallback(() => {
    // 1. 立即更新本地状态
    storeClear()
    // 2. 通过 HTTP API 持久化到后端
    clearAllNotifications()
      .then((res) => {
        setUnreadCount(res.unread_count)
      })
      .catch(() => {
        send({ type: "clear" })
      })
  }, [send, storeClear, setUnreadCount])

  const stopPing = useCallback(() => {
    if (pingTimerRef.current) {
      window.clearInterval(pingTimerRef.current)
      pingTimerRef.current = null
    }
  }, [])

  const startPing = useCallback(() => {
    stopPing()
    pingTimerRef.current = window.setInterval(() => {
      send({ type: "ping" })
    }, PING_INTERVAL_MS)
  }, [send, stopPing])

  const cleanupSocket = useCallback(() => {
    stopPing()
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
  }, [stopPing])

  const scheduleReconnect = useCallback((immediate = false) => {
    if (!activeRef.current || !enabled || !isAuthenticated) return
    if (reconnectTimerRef.current) return

    const attempt = reconnectAttemptRef.current
    const jitter = Math.random() * 400
    const delay = immediate
      ? 0
      : Math.min(
          POLL_RECONNECT_MAX_MS,
          POLL_RECONNECT_BASE_MS * 2 ** attempt + jitter
        )

    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null
      void connect()
    }, delay)
    reconnectAttemptRef.current += 1
  }, [enabled, isAuthenticated])

  const connect = useCallback(async () => {
    if (!enabled || !activeRef.current || !isAuthenticated) return
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return

    let token = getAuthToken()
    if (!token) {
      token = await refreshAccessToken().catch(() => null)
    }

    if (!token) {
      scheduleReconnect()
      return
    }

    if (process.env.NEXT_PUBLIC_IS_TAURI === "true") {
      startLocalMonitorWorker({ accessToken: token }).catch((error) => {
        console.warn("[monitor-worker] start failed", error)
      })
    }

    // 在生产环境中不将token放在URL中，而是依赖cookies进行认证
    // 只在开发环境中保留URL参数方式以方便调试
    const isProd = process.env.NODE_ENV === 'production';
    const wsUrl = isProd 
      ? buildApiWsUrl("/api/v1/notifications/ws") 
      : buildApiWsUrl("/api/v1/notifications/ws", { token });
      
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      reconnectAttemptRef.current = 0
      startPing()
    }

    ws.onmessage = (event) => {
      const message = safeParseMessage(event.data)
      if (!message) return

      if (message.type === "snapshot") {
        const data = message.data as NotificationSnapshotPayload | undefined
        const items = (data?.items ?? [])
          .map(mapBackendItem)
          .filter(Boolean) as NotificationItem[]
        setList(items, data?.unread_count)
        return
      }

      if (message.type === "notification") {
        const data = message.data as NotificationPushPayload | undefined
        const item = data?.item
        
        // Check for Live Task Updates
        if (item?.payload?.is_live_block && taskProgressCallback) {
          taskProgressCallback(item.payload)
          // Don't show these as system notifications to avoid noise
          return 
        }

        const mappedItem = item ? mapBackendItem(item) : null
        if (mappedItem) {
          upsert(mappedItem, data?.unread_count)
        } else if (typeof data?.unread_count === "number") {
          setUnreadCount(data.unread_count)
        }
        return
      }

      if (message.type === "ack") {
        const data = message.data as Record<string, unknown> | undefined
        if (typeof data?.unread_count === "number") {
          setUnreadCount(data.unread_count)
        }
      }
    }

    ws.onclose = async (event) => {
      stopPing()
      wsRef.current = null

      if (!activeRef.current || !enabled) return

      if (event.code === 1008) {
        await refreshAccessToken().catch(() => null)
      }
      scheduleReconnect()
    }

    ws.onerror = () => {
      ws.close()
    }
  }, [enabled, isAuthenticated, scheduleReconnect, setList, setUnreadCount, startPing, stopPing, upsert])

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_IS_TAURI !== "true") {
      return
    }
    if (!enabled || !isAuthenticated) {
      void stopLocalMonitorWorker().catch(() => null)
    }
  }, [enabled, isAuthenticated])

  useEffect(() => {
    if (!enabled || !isAuthenticated) return undefined
    activeRef.current = true
    void connect()

    return () => {
      activeRef.current = false
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      cleanupSocket()
    }
  }, [cleanupSocket, connect, enabled, isAuthenticated])

  return useMemo(
    () => ({
      sendMarkRead,
      sendMarkAllRead,
      sendClear,
    }),
    [sendClear, sendMarkAllRead, sendMarkRead]
  )
}
