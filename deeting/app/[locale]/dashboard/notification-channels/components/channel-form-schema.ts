import type { ChannelConfig, ChannelType } from "@/lib/api/notification-channels"

export type FieldDef = {
  key: string
  labelKey: string
  placeholderKey: string
  type?: "text" | "number" | "password" | "textarea" | "switch" | "select"
  valueKind?: "string" | "number" | "string[]" | "boolean"
  descriptionKey?: string
  options?: Array<{ value: string; labelKey: string }>
}

export const FIELD_DEFS: Record<ChannelType, FieldDef[]> = {
  feishu: [
    {
      key: "webhook_url",
      labelKey: "fields.feishu.webhook_url.label",
      placeholderKey: "fields.feishu.webhook_url.placeholder",
    },
    {
      key: "chat_ids",
      labelKey: "fields.feishu.chat_ids.label",
      placeholderKey: "fields.feishu.chat_ids.placeholder",
      type: "textarea",
      valueKind: "string[]",
      descriptionKey: "fields.feishu.chat_ids.description",
    },
    {
      key: "bot_open_id",
      labelKey: "fields.feishu.bot_open_id.label",
      placeholderKey: "fields.feishu.bot_open_id.placeholder",
    },
    {
      key: "bot_system_prompt",
      labelKey: "fields.feishu.bot_system_prompt.label",
      placeholderKey: "fields.feishu.bot_system_prompt.placeholder",
      type: "textarea",
      descriptionKey: "fields.feishu.bot_system_prompt.description",
    },
    {
      key: "bot_app_id",
      labelKey: "fields.feishu.bot_app_id.label",
      placeholderKey: "fields.feishu.bot_app_id.placeholder",
    },
    {
      key: "bot_app_secret",
      labelKey: "fields.feishu.bot_app_secret.label",
      placeholderKey: "fields.feishu.bot_app_secret.placeholder",
      type: "password",
    },
    {
      key: "im_enabled",
      labelKey: "fields.feishu.im_enabled.label",
      placeholderKey: "fields.feishu.im_enabled.placeholder",
      type: "switch",
      valueKind: "boolean",
      descriptionKey: "fields.feishu.im_enabled.description",
    },
    {
      key: "transport_preference",
      labelKey: "fields.feishu.transport_preference.label",
      placeholderKey: "fields.feishu.transport_preference.placeholder",
      type: "select",
      options: [
        { value: "auto", labelKey: "fieldOptions.transport.auto" },
        { value: "direct", labelKey: "fieldOptions.transport.direct" },
        { value: "relay", labelKey: "fieldOptions.transport.relay" },
      ],
      descriptionKey: "fields.feishu.transport_preference.description",
    },
    {
      key: "relay_base_url",
      labelKey: "fields.feishu.relay_base_url.label",
      placeholderKey: "fields.feishu.relay_base_url.placeholder",
      descriptionKey: "fields.feishu.relay_base_url.description",
    },
    {
      key: "relay_shared_secret",
      labelKey: "fields.feishu.relay_shared_secret.label",
      placeholderKey: "fields.feishu.relay_shared_secret.placeholder",
      type: "password",
      descriptionKey: "fields.feishu.relay_shared_secret.description",
    },
  ],
  dingtalk: [
    {
      key: "webhook_url",
      labelKey: "fields.dingtalk.webhook_url.label",
      placeholderKey: "fields.dingtalk.webhook_url.placeholder",
    },
  ],
  wechat: [
    {
      key: "im_enabled",
      labelKey: "fields.wechat.im_enabled.label",
      placeholderKey: "fields.wechat.im_enabled.placeholder",
      type: "switch",
      valueKind: "boolean",
      descriptionKey: "fields.wechat.im_enabled.description",
    },
    {
      key: "access_policy",
      labelKey: "fields.wechat.access_policy.label",
      placeholderKey: "fields.wechat.access_policy.placeholder",
      type: "select",
      options: [
        { value: "pairing", labelKey: "fieldOptions.accessPolicy.pairing" },
        { value: "allowlist", labelKey: "fieldOptions.accessPolicy.allowlist" },
      ],
      descriptionKey: "fields.wechat.access_policy.description",
    },
    {
      key: "bot_system_prompt",
      labelKey: "fields.wechat.bot_system_prompt.label",
      placeholderKey: "fields.wechat.bot_system_prompt.placeholder",
      type: "textarea",
      descriptionKey: "fields.wechat.bot_system_prompt.description",
    },
    {
      key: "notify_contact_ids",
      labelKey: "fields.wechat.notify_contact_ids.label",
      placeholderKey: "fields.wechat.notify_contact_ids.placeholder",
      type: "textarea",
      valueKind: "string[]",
      descriptionKey: "fields.wechat.notify_contact_ids.description",
    },
  ],
  telegram: [
    {
      key: "bot_token",
      labelKey: "fields.telegram.bot_token.label",
      placeholderKey: "fields.telegram.bot_token.placeholder",
      type: "password",
    },
    {
      key: "chat_id",
      labelKey: "fields.telegram.chat_id.label",
      placeholderKey: "fields.telegram.chat_id.placeholder",
    },
  ],
  email: [
    {
      key: "smtp_host",
      labelKey: "fields.email.smtp_host.label",
      placeholderKey: "fields.email.smtp_host.placeholder",
    },
    {
      key: "smtp_port",
      labelKey: "fields.email.smtp_port.label",
      placeholderKey: "fields.email.smtp_port.placeholder",
      type: "number",
    },
    {
      key: "from_email",
      labelKey: "fields.email.from_email.label",
      placeholderKey: "fields.email.from_email.placeholder",
    },
    {
      key: "from_name",
      labelKey: "fields.email.from_name.label",
      placeholderKey: "fields.email.from_name.placeholder",
    },
    {
      key: "to_email",
      labelKey: "fields.email.to_email.label",
      placeholderKey: "fields.email.to_email.placeholder",
    },
    {
      key: "username",
      labelKey: "fields.email.username.label",
      placeholderKey: "fields.email.username.placeholder",
    },
    {
      key: "password",
      labelKey: "fields.email.password.label",
      placeholderKey: "fields.email.password.placeholder",
      type: "password",
    },
  ],
  webhook: [
    {
      key: "webhook_url",
      labelKey: "fields.webhook.webhook_url.label",
      placeholderKey: "fields.webhook.webhook_url.placeholder",
    },
  ],
}

export const FEISHU_FIELD_GROUPS = [
  {
    titleKey: "feishuGroups.base.title",
    descriptionKey: "feishuGroups.base.description",
    keys: ["webhook_url", "chat_ids", "bot_open_id"],
  },
  {
    titleKey: "feishuGroups.desktopIm.title",
    descriptionKey: "feishuGroups.desktopIm.description",
    keys: [
      "im_enabled",
      "transport_preference",
      "bot_app_id",
      "bot_app_secret",
      "relay_base_url",
      "relay_shared_secret",
    ],
  },
  {
    titleKey: "feishuGroups.replyBehavior.title",
    descriptionKey: "feishuGroups.replyBehavior.description",
    keys: ["bot_system_prompt"],
  },
] as const

export type ChannelFormValue = string | boolean

export function defaultFormValues(channelType: ChannelType): Record<string, ChannelFormValue> {
  if (channelType === "wechat") {
    return {
      im_enabled: true,
      access_policy: "pairing",
    }
  }
  return {}
}

export function configToFormValues(
  fields: FieldDef[],
  config?: ChannelConfig
): Record<string, ChannelFormValue> {
  if (!config) return {}
  const values: Record<string, ChannelFormValue> = {}
  for (const field of fields) {
    const raw = (config as Record<string, unknown>)[field.key]
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
