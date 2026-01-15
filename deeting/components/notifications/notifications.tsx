"use client"

import type { ReactNode } from "react"
import { toast } from "sonner"
import { CheckCircle2, AlertTriangle, XCircle, Info, Sparkles } from "lucide-react"
import { useTranslations } from "next-intl"

export type NotificationType = "success" | "error" | "warning" | "info"

export interface NotificationOptions {
  type?: NotificationType
  title: string
  description?: string
  duration?: number
  icon?: ReactNode
  action?: {
    label: string
    onClick: () => void
  }
}

const iconMap = {
  success: <CheckCircle2 size={16} className="text-green-500" />,
  error: <XCircle size={16} className="text-red-500" />,
  warning: <AlertTriangle size={16} className="text-orange-500" />,
  info: <Info size={16} className="text-blue-500" />,
}

const styleMap = {
  success: "border-green-500/30 bg-green-500/10",
  error: "border-red-500/30 bg-red-500/10", 
  warning: "border-orange-500/30 bg-orange-500/10",
  info: "border-blue-500/30 bg-blue-500/10",
}

export function showNotification(options: NotificationOptions) {
  const { type = "info", title, description, duration = 4000, action, icon } = options
  
  toast(title, {
    description,
    icon: icon ?? iconMap[type],
    duration,
    className: styleMap[type],
    action: action ? {
      label: action.label,
      onClick: action.onClick,
    } : undefined,
  })
}

// 预定义的通知类型
export function useNotifications() {
  const t = useTranslations("notifications")
  
  return {
    success: (title: string, description?: string, action?: NotificationOptions["action"]) =>
      showNotification({ type: "success", title, description, action }),
    
    error: (title: string, description?: string, action?: NotificationOptions["action"]) =>
      showNotification({ type: "error", title, description, action }),
    
    warning: (title: string, description?: string, action?: NotificationOptions["action"]) =>
      showNotification({ type: "warning", title, description, action }),
    
    info: (title: string, description?: string, action?: NotificationOptions["action"]) =>
      showNotification({ type: "info", title, description, action }),
    
    // 预设业务场景
    modelConnected: (model: string, onTest?: () => void) =>
      showNotification({
        type: "success",
        title: t("events.modelConnected"),
        description: t("events.modelConnectedDesc", { model }),
        action: onTest ? { label: t("actions.test"), onClick: onTest } : undefined,
      }),
    
    balanceWarning: (threshold: string, amount: string, onRecharge?: () => void) =>
      showNotification({
        type: "warning",
        title: t("events.balanceWarning"),
        description: t("events.balanceWarningDesc", { threshold, amount }),
        duration: 6000, // 警告显示更长时间
        action: onRecharge ? { label: t("actions.recharge"), onClick: onRecharge } : undefined,
      }),
    
    taskCompleted: (task: string, duration: string, onView?: () => void) =>
      showNotification({
        type: "success",
        title: t("events.taskCompleted"),
        description: t("events.taskCompletedDesc", { task, duration }),
        action: onView ? { label: t("actions.view"), onClick: onView } : undefined,
      }),
    
    taskFailed: (task: string, error: string, onRetry?: () => void) =>
      showNotification({
        type: "error", 
        title: t("events.taskFailed"),
        description: t("events.taskFailedDesc", { task, error }),
        duration: 8000, // 错误显示更长时间
        action: onRetry ? { label: t("actions.retry"), onClick: onRetry } : undefined,
      }),
    
    connectionError: (service: string) =>
      showNotification({
        type: "error",
        title: t("events.connectionError"),
        description: t("events.connectionErrorDesc", { service }),
        duration: 6000,
      }),
    
    imageGenerated: (duration: string, onView?: () => void) =>
      showNotification({
        type: "success",
        title: t("events.imageGenerated"),
        description: t("events.imageGeneratedDesc", { duration }),
        icon: <Sparkles size={16} className="text-purple-500" />,
        action: onView ? { label: t("actions.view"), onClick: onView } : undefined,
      }),
  }
}
