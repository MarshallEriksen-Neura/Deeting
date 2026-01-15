"use client"

import { create } from "zustand"
import { devtools, subscribeWithSelector } from "zustand/middleware"
import { NotificationItem } from "@/components/notifications/notification-center"
import { normalizeNotificationTimestamp, type NotificationTimestamp } from "@/components/notifications/notification-utils"

type NotificationInput = Omit<NotificationItem, "id" | "read" | "timestamp"> & {
  timestamp: NotificationTimestamp
}

const getUnreadCount = (notifications: NotificationItem[]) =>
  notifications.reduce((count, notification) => count + (notification.read ? 0 : 1), 0)

interface NotificationState {
  // Sheet状态
  isNotificationSheetOpen: boolean
  
  // 通知列表
  notifications: NotificationItem[]
  
  // Actions
  setNotificationSheetOpen: (open: boolean) => void
  toggleNotificationSheet: () => void
  
  addNotification: (notification: NotificationInput) => void
  trimNotifications: (max: number) => void
  markAsRead: (id: string) => void
  markAllAsRead: () => void
  clearNotifications: () => void
  removeNotification: (id: string) => void
  
  // 统计
  unreadCount: number
}

export const useNotificationStore = create<NotificationState>()(
  devtools(
    subscribeWithSelector((set, get) => ({
      // 初始状态
      isNotificationSheetOpen: false,
      notifications: [],
      unreadCount: 0,

      // Sheet控制
      setNotificationSheetOpen: (open) => {
        set({ isNotificationSheetOpen: open })
      },

      toggleNotificationSheet: () => {
        set((state) => ({ 
          isNotificationSheetOpen: !state.isNotificationSheetOpen 
        }))
      },

      // 通知管理
      addNotification: (notification: NotificationInput) => {
        const newNotification: NotificationItem = {
          ...notification,
          timestamp: normalizeNotificationTimestamp(notification.timestamp),
          id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          read: false,
        }
        
        set((state) => {
          const notifications = [newNotification, ...state.notifications].slice(0, 50)

          return {
            notifications,
            unreadCount: getUnreadCount(notifications),
          }
        })
      },

      trimNotifications: (max) => {
        set((state) => {
          if (state.notifications.length <= max) {
            return {}
          }

          const notifications = state.notifications.slice(0, max)

          return {
            notifications,
            unreadCount: getUnreadCount(notifications),
          }
        })
      },

      markAsRead: (id) => {
        set((state) => {
          const notifications = state.notifications.map(notification =>
            notification.id === id ? { ...notification, read: true } : notification
          )

          return {
            notifications,
            unreadCount: getUnreadCount(notifications),
          }
        })
      },

      markAllAsRead: () => {
        set((state) => ({
          notifications: state.notifications.map(notification => ({ ...notification, read: true })),
          unreadCount: 0,
        }))
      },

      clearNotifications: () => {
        set({ notifications: [], unreadCount: 0 })
      },

      removeNotification: (id) => {
        set((state) => {
          const notifications = state.notifications.filter(notification => notification.id !== id)

          return {
            notifications,
            unreadCount: getUnreadCount(notifications),
          }
        })
      },
    })),
    {
      name: "notification-store", // 存储名称
    }
  )
)

// 选择器hooks
export const useNotificationSheet = () => {
  return useNotificationStore(state => ({
    isOpen: state.isNotificationSheetOpen,
    setOpen: state.setNotificationSheetOpen,
    toggle: state.toggleNotificationSheet
  }))
}

export const useNotificationsList = () => {
  return useNotificationStore(state => state.notifications)
}

export const useUnreadCount = () => {
  return useNotificationStore(state => state.unreadCount)
}

export const useNotificationActions = () => {
  return useNotificationStore(state => ({
    add: state.addNotification,
    trim: state.trimNotifications,
    markAsRead: state.markAsRead,
    markAllAsRead: state.markAllAsRead,
    clear: state.clearNotifications,
    remove: state.removeNotification
  }))
}
