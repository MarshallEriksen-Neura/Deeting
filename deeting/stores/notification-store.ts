"use client"

import { create } from "zustand"
import { devtools, subscribeWithSelector } from "zustand/middleware"
import { useShallow } from "zustand/react/shallow"
import { NotificationItem } from "@/components/notifications/notification-center"
import { normalizeNotificationTimestamp, type NotificationTimestamp } from "@/components/notifications/notification-utils"

type NotificationInput = Omit<NotificationItem, "id" | "read" | "timestamp"> & {
  timestamp: NotificationTimestamp
}

const getUnreadCount = (notifications: NotificationItem[]) =>
  notifications.reduce((count, notification) => count + (notification.read ? 0 : 1), 0)

const normalizeNotification = (notification: NotificationItem): NotificationItem => ({
  ...notification,
  timestamp: normalizeNotificationTimestamp(notification.timestamp),
})

interface NotificationState {
  // Sheet状态
  isNotificationSheetOpen: boolean
  
  // 通知列表
  notifications: NotificationItem[]
  
  // Actions
  setNotificationSheetOpen: (open: boolean) => void
  toggleNotificationSheet: () => void
  
  addNotification: (notification: NotificationInput) => void
  setNotifications: (notifications: NotificationItem[], unreadCount?: number) => void
  upsertNotification: (notification: NotificationItem, unreadCount?: number) => void
  setUnreadCount: (count: number) => void
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

      setNotifications: (incoming, explicitUnreadCount) => {
        const notifications = incoming.map(normalizeNotification).slice(0, 50)
        set({
          notifications,
          unreadCount: typeof explicitUnreadCount === "number"
            ? Math.max(0, explicitUnreadCount)
            : getUnreadCount(notifications),
        })
      },

      upsertNotification: (incoming, explicitUnreadCount) => {
        const normalized = normalizeNotification(incoming)
        set((state) => {
          const existingIndex = state.notifications.findIndex(
            (notification) => notification.id === normalized.id
          )
          let notifications = state.notifications
          if (existingIndex >= 0) {
            notifications = [
              ...state.notifications.slice(0, existingIndex),
              normalized,
              ...state.notifications.slice(existingIndex + 1),
            ]
          } else {
            notifications = [normalized, ...state.notifications]
          }
          notifications = notifications.slice(0, 50)

          return {
            notifications,
            unreadCount: typeof explicitUnreadCount === "number"
              ? Math.max(0, explicitUnreadCount)
              : getUnreadCount(notifications),
          }
        })
      },

      setUnreadCount: (count) => {
        set({ unreadCount: Math.max(0, count) })
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
  return useNotificationStore(
    useShallow((state) => ({
      isOpen: state.isNotificationSheetOpen,
      setOpen: state.setNotificationSheetOpen,
      toggle: state.toggleNotificationSheet,
    }))
  )
}

export const useNotificationsList = () => {
  return useNotificationStore(state => state.notifications)
}

export const useUnreadCount = () => {
  return useNotificationStore(state => state.unreadCount)
}

export const useNotificationActions = () => {
  return useNotificationStore(
    useShallow((state) => ({
      add: state.addNotification,
      setList: state.setNotifications,
      upsert: state.upsertNotification,
      setUnreadCount: state.setUnreadCount,
      trim: state.trimNotifications,
      markAsRead: state.markAsRead,
      markAllAsRead: state.markAllAsRead,
      clear: state.clearNotifications,
      remove: state.removeNotification,
    }))
  )
}
