"use client"

import { useMemo } from "react"
import { format } from "date-fns"
import { zhCN, enUS } from "date-fns/locale"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { GlassButton } from "@/components/ui/glass-button"
import {
  Bell,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Info,
  Sparkles,
  Settings,
  CheckCheck,
  Trash2,
} from "lucide-react"
import { useTranslations, useLocale } from "next-intl"
import { cn } from "@/lib/utils"
import {
  useNotificationSheet,
  useNotificationsList,
  useNotificationActions,
} from "@/stores/notification-store"
import { normalizeNotificationTimestamp } from "@/components/notifications/notification-utils"

export type NotificationType = "info" | "success" | "warning" | "error"

export interface NotificationItem {
  id: string
  type: NotificationType
  title: string
  description: string
  timestamp: Date
  read: boolean
  action?: {
    label: string
    onClick: () => void
  }
}

const iconMap = {
  success: <CheckCircle2 size={18} className="text-green-600" />,
  error: <XCircle size={18} className="text-red-600" />,
  warning: <AlertTriangle size={18} className="text-orange-600" />,
  info: <Info size={18} className="text-blue-600" />,
}

const iconBgMap = {
  success: "bg-green-100 border-green-200",
  error: "bg-red-100 border-red-200", 
  warning: "bg-orange-100 border-orange-200",
  info: "bg-blue-100 border-blue-200",
}

const badgeColorMap = {
  success: "bg-green-500/10 text-green-700 border-green-200",
  error: "bg-red-500/10 text-red-700 border-red-200",
  warning: "bg-orange-500/10 text-orange-700 border-orange-200",
  info: "bg-blue-500/10 text-blue-700 border-blue-200",
}

export function NotificationCenter() {
  const t = useTranslations("notifications")
  const locale = useLocale()
  const dateLocale = locale === "zh-CN" ? zhCN : enUS
  
  const { isOpen, setOpen } = useNotificationSheet()
  const notifications = useNotificationsList()
  const { markAsRead, markAllAsRead, clear } = useNotificationActions()
  
  const unreadCount = useMemo(() => 
    notifications.filter(n => !n.read).length, [notifications]
  )

  const groupedNotifications = useMemo(() => {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)

    const groups = {
      today: [] as NotificationItem[],
      yesterday: [] as NotificationItem[],
      older: [] as NotificationItem[],
    }

    notifications.forEach(notification => {
      const timestamp = normalizeNotificationTimestamp(notification.timestamp)

      if (timestamp >= today) {
        groups.today.push(notification)
      } else if (timestamp >= yesterday) {
        groups.yesterday.push(notification)
      } else {
        groups.older.push(notification)
      }
    })

    return groups
  }, [notifications])

  const handleNotificationClick = (notification: NotificationItem) => {
    if (!notification.read) {
      markAsRead(notification.id)
    }
    notification.action?.onClick()
  }

  function renderNotification(notification: NotificationItem) {
    return (
      <div key={notification.id} className="relative flex gap-4 group">
        {/* 图标 */}
        <div
          className={cn(
            "z-10 w-10 h-10 rounded-full flex items-center justify-center",
            "border-4 border-white shadow-sm shrink-0",
            iconBgMap[notification.type]
          )}
        >
          {notification.type === "success" && notification.title.includes("图片") ? (
            <Sparkles size={18} className="text-purple-600" />
          ) : (
            iconMap[notification.type]
          )}
        </div>

        {/* 内容卡片 */}
        <div
          className={cn(
            "bg-white p-4 rounded-xl border shadow-sm flex-1",
            "cursor-pointer transition-all duration-200",
            "hover:shadow-md hover:scale-[1.02]",
            notification.read ? "opacity-60 border-gray-100" : "border-gray-200"
          )}
          onClick={() => handleNotificationClick(notification)}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h4 className="font-semibold text-sm text-gray-900">
                  {notification.title}
                </h4>
                {!notification.read && (
                  <div className="w-2 h-2 bg-blue-500 rounded-full" />
                )}
              </div>
              <p className="text-xs text-gray-500 leading-relaxed">
                {notification.description}
              </p>
              {notification.action && (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3 text-xs h-7"
                  onClick={(e) => {
                    e.stopPropagation()
                    notification.action!.onClick()
                  }}
                >
                  {notification.action.label}
                </Button>
              )}
            </div>
            <Badge
              variant="outline"
              className={cn("text-xs", badgeColorMap[notification.type])}
            >
              {t(`types.${notification.type}`)}
            </Badge>
          </div>
          <span className="text-[10px] text-gray-300 mt-2 block font-mono">
            {format(normalizeNotificationTimestamp(notification.timestamp), "HH:mm", { locale: dateLocale })}
          </span>
        </div>
      </div>
    )
  }

  return (
    <Sheet open={isOpen} onOpenChange={setOpen}>
      <SheetContent className="w-[400px] sm:w-[540px] bg-white/90 backdrop-blur-2xl border-l border-white/20">
        <SheetHeader className="mb-6">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-xl font-bold flex items-center gap-2">
              {unreadCount > 0 && (
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              )}
              {t("title")}
            </SheetTitle>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={markAllAsRead}
                  className="text-xs text-gray-600 hover:text-gray-900"
                >
                  <CheckCheck size={14} className="mr-1" />
                  {t("markAllRead")}
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={clear}
                className="text-xs text-gray-600 hover:text-gray-900"
              >
                <Trash2 size={14} className="mr-1" />
                {t("clear")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-gray-600 hover:text-gray-900"
              >
                <Settings size={14} className="mr-1" />
                {t("settings")}
              </Button>
            </div>
          </div>
        </SheetHeader>

        <ScrollArea className="h-full pr-4">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                <Bell size={24} className="text-gray-400" />
              </div>
              <p className="text-gray-500 text-sm">{t("noNotifications")}</p>
            </div>
          ) : (
            <div className="space-y-8 relative">
              
              {/* 时间轴线条 */}
              <div className="absolute left-[19px] top-2 bottom-0 w-[1px] bg-gray-200" />

              {/* Today */}
              {groupedNotifications.today.length > 0 && (
                <div className="space-y-4">
                  <h3 className="text-xs font-mono text-gray-400 uppercase tracking-wider bg-white/50 backdrop-blur inline-block px-2 rounded ml-8">
                    {t("today")}
                  </h3>
                  {groupedNotifications.today.map(renderNotification)}
                </div>
              )}

              {/* Yesterday */}
              {groupedNotifications.yesterday.length > 0 && (
                <div className="space-y-4">
                  <h3 className="text-xs font-mono text-gray-400 uppercase tracking-wider bg-white/50 backdrop-blur inline-block px-2 rounded ml-8">
                    {t("yesterday")}
                  </h3>
                  {groupedNotifications.yesterday.map(renderNotification)}
                </div>
              )}

              {/* Older */}
              {groupedNotifications.older.length > 0 && (
                <div className="space-y-4">
                  <h3 className="text-xs font-mono text-gray-400 uppercase tracking-wider bg-white/50 backdrop-blur inline-block px-2 rounded ml-8">
                    {t("older")}
                  </h3>
                  {groupedNotifications.older.map(renderNotification)}
                </div>
              )}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}

// 单独的铃铛触发按钮组件
export function NotificationBell() {
  const { toggle } = useNotificationSheet()
  const notifications = useNotificationsList()
  
  const unreadCount = notifications.filter(n => !n.read).length

  return (
    <GlassButton
      onClick={toggle}
      variant="ghost"
      size="icon-sm"
      className="relative text-gray-600 hover:text-gray-900"
    >
      <Bell size={20} />
      {unreadCount > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-red-500 text-white text-xs font-bold rounded-full border-2 border-white flex items-center justify-center">
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      )}
    </GlassButton>
  )
}
