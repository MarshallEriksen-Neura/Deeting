import type { ChannelConfig, ChannelType } from "@/lib/api/notification-channels"

export type FieldDef = {
  key: string
  label: string
  placeholder: string
  type?: "text" | "number" | "password" | "textarea" | "switch" | "select"
  valueKind?: "string" | "number" | "string[]" | "boolean"
  description?: string
  options?: Array<{ value: string; label: string }>
}

export const FIELD_DEFS: Record<ChannelType, FieldDef[]> = {
  feishu: [
    {
      key: "webhook_url",
      label: "Webhook URL",
      placeholder: "https://open.feishu.cn/open-apis/bot/v2/hook/...",
    },
    {
      key: "chat_ids",
      label: "Chat IDs",
      placeholder: "每行一个 chat_id",
      type: "textarea",
      valueKind: "string[]",
      description: "可选，指定要投递的群聊 ID 列表。",
    },
    {
      key: "bot_open_id",
      label: "Bot Open ID",
      placeholder: "ou_xxx",
    },
    {
      key: "bot_app_id",
      label: "Bot App ID",
      placeholder: "cli_xxx",
    },
    {
      key: "bot_app_secret",
      label: "Bot App Secret",
      placeholder: "输入飞书 Bot 密钥",
      type: "password",
    },
    {
      key: "im_enabled",
      label: "启用桌面 IM",
      placeholder: "启用后允许桌面 IM 通道介入",
      type: "switch",
      valueKind: "boolean",
      description: "开启后，这个渠道会参与桌面端 IM 运行时。",
    },
    {
      key: "transport_preference",
      label: "传输偏好",
      placeholder: "选择传输模式",
      type: "select",
      options: [
        { value: "auto", label: "自动" },
        { value: "direct", label: "直连" },
        { value: "relay", label: "Relay" },
      ],
      description: "决定优先使用本地直连还是 relay。",
    },
    {
      key: "relay_base_url",
      label: "Relay Base URL",
      placeholder: "https://relay.example.com",
      description: "当偏好为 relay 或 auto fallback 时使用。",
    },
    {
      key: "relay_shared_secret",
      label: "Relay Shared Secret",
      placeholder: "输入 relay 共享密钥",
      type: "password",
      description: "Relay 鉴权使用的共享密钥。",
    },
  ],
  dingtalk: [
    {
      key: "webhook_url",
      label: "Webhook URL",
      placeholder: "https://oapi.dingtalk.com/robot/send?...",
    },
  ],
  wechat: [
    {
      key: "im_enabled",
      label: "启用桌面 IM",
      placeholder: "启用微信桌面连接",
      type: "switch",
      valueKind: "boolean",
      description: "关闭后不会参与桌面端 IM 运行时。",
    },
    {
      key: "access_policy",
      label: "接入策略",
      placeholder: "选择接入策略",
      type: "select",
      options: [
        { value: "pairing", label: "配对审批" },
        { value: "allowlist", label: "白名单" },
      ],
      description: "配对审批更安全，白名单适合固定联系人。",
    },
    {
      key: "notify_contact_ids",
      label: "通知联系人",
      placeholder: "每行一个 contact_id",
      type: "textarea",
      valueKind: "string[]",
      description: "这些联系人会接收主动寻猎或自动化通知。",
    },
  ],
  telegram: [
    {
      key: "im_enabled",
      label: "启用桌面 IM",
      placeholder: "启用 Telegram 桌面通道",
      type: "switch",
      valueKind: "boolean",
      description: "关闭后不参与桌面端 IM 运行时。",
    },
    {
      key: "media_enabled",
      label: "启用媒体发送",
      placeholder: "允许图片或其他媒体",
      type: "switch",
      valueKind: "boolean",
      description: "控制是否允许发送媒体内容。",
    },
    {
      key: "bot_token",
      label: "Bot Token",
      placeholder: "123456:ABC...",
      type: "password",
    },
    {
      key: "chat_id",
      label: "Chat ID",
      placeholder: "输入 Telegram chat_id",
    },
  ],
  email: [
    {
      key: "smtp_host",
      label: "SMTP Host",
      placeholder: "smtp.example.com",
    },
    {
      key: "smtp_port",
      label: "SMTP Port",
      placeholder: "587",
      type: "number",
    },
    {
      key: "from_email",
      label: "From Email",
      placeholder: "bot@example.com",
    },
    {
      key: "from_name",
      label: "From Name",
      placeholder: "Deeting Bot",
    },
    {
      key: "to_email",
      label: "To Email",
      placeholder: "owner@example.com",
    },
    {
      key: "username",
      label: "Username",
      placeholder: "SMTP 用户名",
    },
    {
      key: "password",
      label: "Password",
      placeholder: "SMTP 密码",
      type: "password",
    },
  ],
  webhook: [
    {
      key: "webhook_url",
      label: "Webhook URL",
      placeholder: "https://example.com/webhook",
    },
  ],
}

export const FEISHU_FIELD_GROUPS = [
  {
    title: "基础投递",
    description: "用于普通消息投递和群聊通知。",
    keys: ["webhook_url", "chat_ids", "bot_open_id"],
  },
  {
    title: "桌面 IM 运行时",
    description: "用于桌面端飞书 IM 接入和 transport 配置。",
    keys: [
      "im_enabled",
      "transport_preference",
      "bot_app_id",
      "bot_app_secret",
      "relay_base_url",
      "relay_shared_secret",
    ],
  },
] as const

export type ChannelFormValue = string | boolean

export function defaultFormValues(channelType: ChannelType): Record<string, ChannelFormValue> {
  if (channelType === "wechat" || channelType === "telegram") {
    return {
      im_enabled: true,
      ...(channelType === "wechat" ? { access_policy: "pairing" } : {}),
      ...(channelType === "telegram" ? { media_enabled: false } : {}),
    }
  }
  return {}
}

export function configToFormValues(
  fields: FieldDef[],
  config?: ChannelConfig,
): Record<string, ChannelFormValue> {
  if (!config) return {}
  const values: Record<string, ChannelFormValue> = {}
  const imConfig =
    config.im_config && typeof config.im_config === "object" ? config.im_config : undefined

  for (const field of fields) {
    const raw =
      (imConfig ? (imConfig as Record<string, unknown>)[field.key] : undefined) ??
      (config as Record<string, unknown>)[field.key]

    if (raw === undefined || raw === null) continue

    if (field.valueKind === "boolean") {
      values[field.key] = Boolean(raw)
      continue
    }

    if (field.valueKind === "string[]") {
      if (Array.isArray(raw)) {
        values[field.key] = raw.map((item) => String(item).trim()).filter(Boolean).join("\n")
      } else if (typeof raw === "string") {
        values[field.key] = raw
      }
      continue
    }

    values[field.key] = String(raw)
  }

  return values
}
