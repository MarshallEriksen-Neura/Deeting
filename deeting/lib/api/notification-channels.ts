import { request } from "@/lib/http"

// =====================
// Types
// =====================

export type ChannelType = "feishu" | "dingtalk" | "telegram" | "email" | "webhook"

export interface NotificationChannel {
  id: string
  user_id: string
  channel: ChannelType
  config?: ChannelConfig
  display_name: string | null
  is_active: boolean
  priority: number
  last_used_at: string | null
  created_at: string
  updated_at: string
}

export interface NotificationChannelList {
  items: NotificationChannel[]
  total: number
}

export interface ChannelConfig {
  // Feishu / DingTalk / Webhook
  webhook_url?: string
  // Feishu bot advanced config
  chat_ids?: string[]
  bot_open_id?: string
  bot_model?: string
  bot_system_prompt?: string
  bot_app_id?: string
  bot_app_secret?: string
  // Telegram
  bot_token?: string
  chat_id?: string
  // Email
  smtp_host?: string
  smtp_port?: number
  from_email?: string
  from_name?: string
  to_email?: string
  username?: string
  password?: string
  use_tls?: boolean
  // DingTalk extras
  at_mobiles?: string[]
  is_at_all?: boolean
  // Webhook extras
  method?: string
}

export interface CreateChannelInput {
  channel: ChannelType
  config: ChannelConfig
  display_name?: string
  priority?: number
}

export interface UpdateChannelInput {
  config?: ChannelConfig
  display_name?: string
  priority?: number
  is_active?: boolean
}

export interface TestChannelInput {
  channel: ChannelType
  config: ChannelConfig
}

export interface TestChannelResult {
  success: boolean
  channel: string
  message: string | null
}

// =====================
// API Functions
// =====================

const BASE = "/api/v1/notification-channels"
const isTauriRuntime = () =>
  process.env.NEXT_PUBLIC_IS_TAURI === "true" &&
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<T>(command, args)
}

export async function fetchNotificationChannels(): Promise<NotificationChannelList> {
  if (isTauriRuntime()) {
    return invokeTauri<NotificationChannelList>("list_local_notification_channels")
  }
  return request<NotificationChannelList>({ url: BASE, method: "GET" })
}

export async function fetchNotificationChannel(
  channelId: string
): Promise<NotificationChannel> {
  if (isTauriRuntime()) {
    return invokeTauri<NotificationChannel>("get_local_notification_channel", {
      channel_id: channelId,
    })
  }
  return request<NotificationChannel>({
    url: `${BASE}/${channelId}`,
    method: "GET",
  })
}

export async function createNotificationChannel(
  data: CreateChannelInput
): Promise<{ id: string; channel: string; message: string }> {
  if (isTauriRuntime()) {
    return invokeTauri<{ id: string; channel: string; message: string }>(
      "create_local_notification_channel",
      { payload: data }
    )
  }
  return request({ url: BASE, method: "POST", data })
}

export async function updateNotificationChannel(
  channelId: string,
  data: UpdateChannelInput
): Promise<{ id: string; message: string }> {
  if (isTauriRuntime()) {
    return invokeTauri<{ id: string; message: string }>("update_local_notification_channel", {
      channel_id: channelId,
      payload: data,
    })
  }
  return request({ url: `${BASE}/${channelId}`, method: "PATCH", data })
}

export async function deleteNotificationChannel(
  channelId: string
): Promise<{ message: string }> {
  if (isTauriRuntime()) {
    return invokeTauri<{ message: string }>("delete_local_notification_channel", {
      channel_id: channelId,
    })
  }
  return request({ url: `${BASE}/${channelId}`, method: "DELETE" })
}

export async function testNotificationChannel(
  data: TestChannelInput
): Promise<TestChannelResult> {
  if (isTauriRuntime()) {
    return invokeTauri<TestChannelResult>("test_local_notification_channel", {
      payload: data,
    })
  }
  return request<TestChannelResult>({
    url: `${BASE}/test`,
    method: "POST",
    data,
  })
}

// =====================
// Channel metadata
// =====================

export const CHANNEL_META: Record<
  ChannelType,
  { label: string; icon: string; color: string; description: string }
> = {
  feishu: {
    label: "飞书",
    icon: "feishu",
    color: "text-blue-400",
    description: "通过飞书机器人 Webhook 推送消息",
  },
  dingtalk: {
    label: "钉钉",
    icon: "dingtalk",
    color: "text-sky-400",
    description: "通过钉钉群机器人 Webhook 推送消息",
  },
  telegram: {
    label: "Telegram",
    icon: "telegram",
    color: "text-cyan-400",
    description: "通过 Telegram Bot 推送消息到指定 Chat",
  },
  email: {
    label: "邮件",
    icon: "email",
    color: "text-amber-400",
    description: "通过 SMTP 服务发送邮件通知",
  },
  webhook: {
    label: "Webhook",
    icon: "webhook",
    color: "text-purple-400",
    description: "向自定义 HTTP 端点推送 JSON 载荷",
  },
}

/** Fields required per channel type for form validation */
export const CHANNEL_REQUIRED_FIELDS: Record<ChannelType, string[]> = {
  feishu: ["webhook_url"],
  dingtalk: ["webhook_url"],
  telegram: ["bot_token", "chat_id"],
  email: ["smtp_host", "smtp_port", "from_email", "to_email"],
  webhook: ["webhook_url"],
}
