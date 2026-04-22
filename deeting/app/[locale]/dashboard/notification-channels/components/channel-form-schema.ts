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
      labelKey: "notificationChannels.form.fields.feishu.webhookUrl.label",
      placeholderKey: "notificationChannels.form.fields.feishu.webhookUrl.placeholder",
    },
    {
      key: "chat_ids",
      labelKey: "notificationChannels.form.fields.feishu.chatIds.label",
      placeholderKey: "notificationChannels.form.fields.feishu.chatIds.placeholder",
      type: "textarea",
      valueKind: "string[]",
      descriptionKey: "notificationChannels.form.fields.feishu.chatIds.description",
    },
    {
      key: "bot_open_id",
      labelKey: "notificationChannels.form.fields.feishu.botOpenId.label",
      placeholderKey: "notificationChannels.form.fields.feishu.botOpenId.placeholder",
    },
    {
      key: "bot_app_id",
      labelKey: "notificationChannels.form.fields.feishu.botAppId.label",
      placeholderKey: "notificationChannels.form.fields.feishu.botAppId.placeholder",
    },
    {
      key: "bot_app_secret",
      labelKey: "notificationChannels.form.fields.feishu.botAppSecret.label",
      placeholderKey: "notificationChannels.form.fields.feishu.botAppSecret.placeholder",
      type: "password",
    },
    {
      key: "im_enabled",
      labelKey: "notificationChannels.form.fields.feishu.imEnabled.label",
      placeholderKey: "notificationChannels.form.fields.feishu.imEnabled.placeholder",
      type: "switch",
      valueKind: "boolean",
      descriptionKey: "notificationChannels.form.fields.feishu.imEnabled.description",
    },
    {
      key: "transport_preference",
      labelKey: "notificationChannels.form.fields.feishu.transportPreference.label",
      placeholderKey: "notificationChannels.form.fields.feishu.transportPreference.placeholder",
      type: "select",
      options: [
        {
          value: "auto",
          labelKey: "notificationChannels.form.fields.feishu.transportPreference.options.auto",
        },
        {
          value: "direct",
          labelKey: "notificationChannels.form.fields.feishu.transportPreference.options.direct",
        },
        {
          value: "relay",
          labelKey: "notificationChannels.form.fields.feishu.transportPreference.options.relay",
        },
      ],
      descriptionKey: "notificationChannels.form.fields.feishu.transportPreference.description",
    },
    {
      key: "relay_base_url",
      labelKey: "notificationChannels.form.fields.feishu.relayBaseUrl.label",
      placeholderKey: "notificationChannels.form.fields.feishu.relayBaseUrl.placeholder",
      descriptionKey: "notificationChannels.form.fields.feishu.relayBaseUrl.description",
    },
    {
      key: "relay_shared_secret",
      labelKey: "notificationChannels.form.fields.feishu.relaySharedSecret.label",
      placeholderKey: "notificationChannels.form.fields.feishu.relaySharedSecret.placeholder",
      type: "password",
      descriptionKey: "notificationChannels.form.fields.feishu.relaySharedSecret.description",
    },
  ],
  dingtalk: [
    {
      key: "webhook_url",
      labelKey: "notificationChannels.form.fields.dingtalk.webhookUrl.label",
      placeholderKey: "notificationChannels.form.fields.dingtalk.webhookUrl.placeholder",
    },
  ],
  wechat: [
    {
      key: "im_enabled",
      labelKey: "notificationChannels.form.fields.wechat.imEnabled.label",
      placeholderKey: "notificationChannels.form.fields.wechat.imEnabled.placeholder",
      type: "switch",
      valueKind: "boolean",
      descriptionKey: "notificationChannels.form.fields.wechat.imEnabled.description",
    },
    {
      key: "access_policy",
      labelKey: "notificationChannels.form.fields.wechat.accessPolicy.label",
      placeholderKey: "notificationChannels.form.fields.wechat.accessPolicy.placeholder",
      type: "select",
      options: [
        {
          value: "pairing",
          labelKey: "notificationChannels.form.fields.wechat.accessPolicy.options.pairing",
        },
        {
          value: "allowlist",
          labelKey: "notificationChannels.form.fields.wechat.accessPolicy.options.allowlist",
        },
      ],
      descriptionKey: "notificationChannels.form.fields.wechat.accessPolicy.description",
    },
    {
      key: "notify_contact_ids",
      labelKey: "notificationChannels.form.fields.wechat.notifyContactIds.label",
      placeholderKey: "notificationChannels.form.fields.wechat.notifyContactIds.placeholder",
      type: "textarea",
      valueKind: "string[]",
      descriptionKey: "notificationChannels.form.fields.wechat.notifyContactIds.description",
    },
  ],
  telegram: [
    {
      key: "im_enabled",
      labelKey: "notificationChannels.form.fields.telegram.imEnabled.label",
      placeholderKey: "notificationChannels.form.fields.telegram.imEnabled.placeholder",
      type: "switch",
      valueKind: "boolean",
      descriptionKey: "notificationChannels.form.fields.telegram.imEnabled.description",
    },
    {
      key: "media_enabled",
      labelKey: "notificationChannels.form.fields.telegram.mediaEnabled.label",
      placeholderKey: "notificationChannels.form.fields.telegram.mediaEnabled.placeholder",
      type: "switch",
      valueKind: "boolean",
      descriptionKey: "notificationChannels.form.fields.telegram.mediaEnabled.description",
    },
    {
      key: "bot_token",
      labelKey: "notificationChannels.form.fields.telegram.botToken.label",
      placeholderKey: "notificationChannels.form.fields.telegram.botToken.placeholder",
      type: "password",
    },
    {
      key: "chat_id",
      labelKey: "notificationChannels.form.fields.telegram.chatId.label",
      placeholderKey: "notificationChannels.form.fields.telegram.chatId.placeholder",
    },
  ],
  email: [
    {
      key: "smtp_host",
      labelKey: "notificationChannels.form.fields.email.smtpHost.label",
      placeholderKey: "notificationChannels.form.fields.email.smtpHost.placeholder",
    },
    {
      key: "smtp_port",
      labelKey: "notificationChannels.form.fields.email.smtpPort.label",
      placeholderKey: "notificationChannels.form.fields.email.smtpPort.placeholder",
      type: "number",
    },
    {
      key: "from_email",
      labelKey: "notificationChannels.form.fields.email.fromEmail.label",
      placeholderKey: "notificationChannels.form.fields.email.fromEmail.placeholder",
    },
    {
      key: "from_name",
      labelKey: "notificationChannels.form.fields.email.fromName.label",
      placeholderKey: "notificationChannels.form.fields.email.fromName.placeholder",
    },
    {
      key: "to_email",
      labelKey: "notificationChannels.form.fields.email.toEmail.label",
      placeholderKey: "notificationChannels.form.fields.email.toEmail.placeholder",
    },
    {
      key: "username",
      labelKey: "notificationChannels.form.fields.email.username.label",
      placeholderKey: "notificationChannels.form.fields.email.username.placeholder",
    },
    {
      key: "password",
      labelKey: "notificationChannels.form.fields.email.password.label",
      placeholderKey: "notificationChannels.form.fields.email.password.placeholder",
      type: "password",
    },
  ],
  webhook: [
    {
      key: "webhook_url",
      labelKey: "notificationChannels.form.fields.webhook.webhookUrl.label",
      placeholderKey: "notificationChannels.form.fields.webhook.webhookUrl.placeholder",
    },
  ],
}

export const FEISHU_FIELD_GROUPS = [
  {
    titleKey: "notificationChannels.form.groups.feishu.delivery.title",
    descriptionKey: "notificationChannels.form.groups.feishu.delivery.description",
    keys: ["webhook_url", "chat_ids", "bot_open_id"],
  },
  {
    titleKey: "notificationChannels.form.groups.feishu.desktopIm.title",
    descriptionKey: "notificationChannels.form.groups.feishu.desktopIm.description",
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
