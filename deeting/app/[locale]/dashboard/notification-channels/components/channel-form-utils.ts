"use client"

import {
  CHANNEL_REQUIRED_FIELDS,
  type ChannelConfig,
  type ChannelType,
} from "@/lib/api/notification-channels"

import type { FieldDef, ChannelFormValue } from "./channel-form-schema"

type WechatConfigState = {
  state: "disconnected" | "qr_ready" | "connecting" | "connected" | "error"
  accountLabel?: string
}

export function buildChannelConfig(
  channelType: ChannelType,
  fields: FieldDef[],
  values: Record<string, ChannelFormValue>,
  options?: {
    wechatState?: WechatConfigState
  },
): ChannelConfig {
  const config: ChannelConfig = {}
  const imConfig: Record<string, unknown> = {}

  for (const field of fields) {
    const value = values[field.key]
    if (field.valueKind === "boolean") {
      ;(config as Record<string, unknown>)[field.key] = Boolean(value)
      imConfig[field.key] = Boolean(value)
      continue
    }
    if (typeof value !== "string" || value === "") {
      continue
    }
    if (field.valueKind === "string[]") {
      const items = splitStringList(value)
      if (items.length > 0) {
        ;(config as Record<string, unknown>)[field.key] = items
        imConfig[field.key] = items
      }
      continue
    }
    if (field.type === "number" || field.valueKind === "number") {
      const parsed = parseInt(value, 10)
      if (Number.isFinite(parsed)) {
        ;(config as Record<string, unknown>)[field.key] = parsed
        imConfig[field.key] = parsed
      }
      continue
    }
    const normalized = value.trim()
    if (normalized) {
      ;(config as Record<string, unknown>)[field.key] = normalized
      imConfig[field.key] = normalized
    }
  }

  if (channelType === "wechat") {
    config.access_policy =
      typeof values.access_policy === "string" && values.access_policy.trim().length > 0
        ? (values.access_policy as "pairing" | "allowlist")
        : "pairing"
    config.im_enabled = Boolean(values.im_enabled)
    if (options?.wechatState) {
      config.connection_state =
        options.wechatState.state === "qr_ready"
          ? "connecting"
          : options.wechatState.state
      if (
        options.wechatState.state === "connected" &&
        options.wechatState.accountLabel
      ) {
        config.account_label = options.wechatState.accountLabel
      }
    }
    if (
      typeof values.account_label === "string" &&
      values.account_label.trim().length > 0
    ) {
      config.account_label = values.account_label.trim()
    }
    imConfig.access_policy = config.access_policy
    imConfig.im_enabled = config.im_enabled
    if (config.connection_state) {
      imConfig.connection_state = config.connection_state
    }
    if (config.account_label) {
      imConfig.account_label = config.account_label
    }
  }

  if (channelType === "telegram") {
    config.im_enabled = Boolean(values.im_enabled)
    config.media_enabled = Boolean(values.media_enabled)
    imConfig.im_enabled = config.im_enabled
    imConfig.media_enabled = config.media_enabled
  }

  if (channelType === "feishu" || channelType === "wechat" || channelType === "telegram") {
    config.im_config = imConfig
  }

  return config
}

export function validateChannelConfig(
  channelType: ChannelType,
  values: Record<string, ChannelFormValue>,
) {
  const required = CHANNEL_REQUIRED_FIELDS[channelType]

  if (channelType === "wechat") {
    return true
  }

  if (channelType === "telegram") {
    const imEnabled = Boolean(values.im_enabled)
    if (!imEnabled) return true
    return required.every((key) => hasNonEmptyString(values[key]))
  }

  if (channelType !== "feishu") {
    return required.every((key) => hasNonEmptyString(values[key]))
  }

  const hasWebhook = hasNonEmptyString(values.webhook_url)
  const imEnabled = Boolean(values.im_enabled)
  const preference =
    (typeof values.transport_preference === "string" && values.transport_preference) ||
    "auto"
  const hasDirectCreds =
    hasNonEmptyString(values.bot_app_id) && hasNonEmptyString(values.bot_app_secret)
  const hasRelayBaseUrl = hasNonEmptyString(values.relay_base_url)

  if (!hasWebhook && !imEnabled) return false
  if (!imEnabled) return true
  if (preference === "direct") return hasDirectCreds
  if (preference === "relay") return hasRelayBaseUrl
  return hasDirectCreds || hasRelayBaseUrl
}

export function isFeishuFieldMuted(
  fieldKey: string,
  values: Record<string, ChannelFormValue>,
) {
  if (["bot_app_id", "bot_app_secret"].includes(fieldKey)) {
    return !Boolean(values.im_enabled) || values.transport_preference === "relay"
  }
  if (["relay_base_url", "relay_shared_secret"].includes(fieldKey)) {
    return !Boolean(values.im_enabled) || values.transport_preference === "direct"
  }
  return false
}

export function splitStringList(value: string) {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function hasNonEmptyString(value: ChannelFormValue | undefined) {
  return typeof value === "string" && value.trim().length > 0
}
