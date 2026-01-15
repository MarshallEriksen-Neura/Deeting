"use client"

import { createContext, useContext, useCallback, useState, ReactNode } from "react"
import { useNotificationActions, useNotificationsList } from "@/stores/notification-store"

// 通知系统上下文 - 现在主要用于环境光状态管理
interface NotificationContextType {
  // 环境光状态管理
  processingState: {
    isProcessing: boolean
    message?: string
  }
  setProcessing: (active: boolean, message?: string) => void
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined)

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [processingState, setProcessingState] = useState({
    isProcessing: false,
    message: ""
  })

  const setProcessing = useCallback((active: boolean, message?: string) => {
    setProcessingState({
      isProcessing: active,
      message: message || ""
    })
  }, [])

  return (
    <NotificationContext.Provider value={{
      processingState,
      setProcessing
    }}>
      {children}
    </NotificationContext.Provider>
  )
}

export function useNotifications() {
  // 环境光状态
  const context = useContext(NotificationContext)
  if (!context) {
    throw new Error("useNotifications must be used within NotificationProvider")
  }
  
  // 持久通知状态 - 使用Zustand
  const notifications = useNotificationsList()
  const actions = useNotificationActions()
  
  // 如果是错误或警告，同时显示为瞬态通知
  const addNotification = useCallback((notification: Parameters<typeof actions.add>[0]) => {
    actions.add(notification)
    
    if (notification.type === "error" || notification.type === "warning") {
      import("@/components/notifications/notifications").then(({ showNotification }) => {
        showNotification({
          type: notification.type,
          title: notification.title,
          description: notification.description,
          duration: notification.type === "error" ? 6000 : 4000
        })
      })
    }
  }, [actions])

  return {
    // 持久通知 - Zustand
    notifications,
    addNotification,
    trimNotifications: actions.trim,
    markAsRead: actions.markAsRead,
    markAllAsRead: actions.markAllAsRead,
    clearNotifications: actions.clear,
    
    // 环境光 - Context
    processingState: context.processingState,
    setProcessing: context.setProcessing,
  }
}
