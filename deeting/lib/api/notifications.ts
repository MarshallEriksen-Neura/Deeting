import { request } from "@/lib/http"

export interface NotificationActionResponse {
  success: boolean
  unread_count: number
}

const NOTIFICATIONS_BASE = "/api/v1/notifications"

/** 标记单条通知为已读 */
export async function markNotificationRead(notificationId: string): Promise<NotificationActionResponse> {
  return request<NotificationActionResponse>({
    url: `${NOTIFICATIONS_BASE}/${notificationId}/read`,
    method: "POST",
  })
}

/** 标记所有通知为已读 */
export async function markAllNotificationsRead(): Promise<NotificationActionResponse> {
  return request<NotificationActionResponse>({
    url: `${NOTIFICATIONS_BASE}/read-all`,
    method: "POST",
  })
}

/** 清空所有通知（归档） */
export async function clearAllNotifications(): Promise<NotificationActionResponse> {
  return request<NotificationActionResponse>({
    url: `${NOTIFICATIONS_BASE}/clear`,
    method: "POST",
  })
}
