"use client"

import { useState } from "react"
import { Plus } from "lucide-react"

import { Badge } from "@/components/ui/shadcn/badge"
import { Button } from "@/components/ui/shadcn/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/shadcn/card"
import { Input } from "@/components/ui/shadcn/input"
import { CHANNEL_REQUIRED_FIELDS, CHANNEL_META, type ChannelConfig, type ChannelType } from "@/lib/api/notification-channels"

import { ChannelFormField } from "./channel-form-field"
import {
  configToFormValues,
  defaultFormValues,
  FIELD_DEFS,
  type ChannelFormValue,
  type FieldDef,
} from "./channel-form-schema"
import { CHANNEL_COLORS, CHANNEL_ICONS } from "./channel-shared"

export function AddChannelCard({
  showAdd,
  addType,
  availableTypes,
  onShowAdd,
  onCancelAdd,
  onSelectType,
  onResetType,
  onCreate,
}: {
  showAdd: boolean
  addType: ChannelType | null
  availableTypes: ChannelType[]
  onShowAdd: () => void
  onCancelAdd: () => void
  onSelectType: (channelType: ChannelType) => void
  onResetType: () => void
  onCreate: (channelType: ChannelType, config: ChannelConfig, displayName: string) => Promise<void>
}) {
  if (!availableTypes.length) {
    return null
  }

  return showAdd ? (
    <AddChannelComposer
      addType={addType}
      availableTypes={availableTypes}
      onCancelAdd={onCancelAdd}
      onSelectType={onSelectType}
      onResetType={onResetType}
      onCreate={onCreate}
    />
  ) : (
    <Button variant="outline" onClick={onShowAdd} className="w-full border-dashed">
      <Plus className="size-4" />
      新增通知渠道
    </Button>
  )
}

function AddChannelComposer({
  addType,
  availableTypes,
  onCancelAdd,
  onSelectType,
  onResetType,
  onCreate,
}: {
  addType: ChannelType | null
  availableTypes: ChannelType[]
  onCancelAdd: () => void
  onSelectType: (channelType: ChannelType) => void
  onResetType: () => void
  onCreate: (channelType: ChannelType, config: ChannelConfig, displayName: string) => Promise<void>
}) {
  const [displayName, setDisplayName] = useState("")
  const [creating, setCreating] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const fields = addType ? FIELD_DEFS[addType] : []
  const required = addType ? CHANNEL_REQUIRED_FIELDS[addType] : []
  const [values, setValues] = useState<Record<string, ChannelFormValue>>({})

  function setValue(key: string, value: ChannelFormValue) {
    setValues((current) => ({ ...current, [key]: value }))
  }

  function resetForType(channelType: ChannelType | null) {
    setValues(channelType ? { ...defaultFormValues(channelType), ...configToFormValues(FIELD_DEFS[channelType]) } : {})
    setFeedback(null)
  }

  function buildConfig(channelType: ChannelType): ChannelConfig {
    const config: ChannelConfig = {}
    const imConfig: Record<string, unknown> = {}
    const currentFields = FIELD_DEFS[channelType]

    for (const field of currentFields) {
      const value = values[field.key]
      if (field.valueKind === "boolean") {
        ;(config as Record<string, unknown>)[field.key] = Boolean(value)
        imConfig[field.key] = Boolean(value)
        continue
      }
      if (typeof value !== "string" || value === "") continue
      if (field.valueKind === "string[]") {
        const items = value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean)
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
      config.access_policy = typeof values.access_policy === "string" && values.access_policy.trim().length > 0 ? (values.access_policy as "pairing" | "allowlist") : "pairing"
      config.im_enabled = Boolean(values.im_enabled)
      imConfig.access_policy = config.access_policy
      imConfig.im_enabled = config.im_enabled
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

  function validateConfig(channelType: ChannelType) {
    if (channelType === "wechat") return true
    if (channelType === "telegram") {
      const imEnabled = Boolean(values.im_enabled)
      if (!imEnabled) return true
      return required.every((key) => {
        const value = values[key]
        return typeof value === "string" && value.trim().length > 0
      })
    }
    if (channelType !== "feishu") {
      return required.every((key) => {
        const value = values[key]
        return typeof value === "string" && value.trim().length > 0
      })
    }
    const hasWebhook = typeof values.webhook_url === "string" && values.webhook_url.trim().length > 0
    const imEnabled = Boolean(values.im_enabled)
    const preference = (typeof values.transport_preference === "string" && values.transport_preference) || "auto"
    const hasDirectCreds = typeof values.bot_app_id === "string" && values.bot_app_id.trim().length > 0 && typeof values.bot_app_secret === "string" && values.bot_app_secret.trim().length > 0
    const hasRelayBaseUrl = typeof values.relay_base_url === "string" && values.relay_base_url.trim().length > 0

    if (!hasWebhook && !imEnabled) return false
    if (!imEnabled) return true
    if (preference === "direct") return hasDirectCreds
    if (preference === "relay") return hasRelayBaseUrl
    return hasDirectCreds || hasRelayBaseUrl
  }

  async function handleCreate() {
    if (!addType || !validateConfig(addType)) return
    setCreating(true)
    setFeedback(null)
    try {
      await onCreate(addType, buildConfig(addType), displayName)
      setDisplayName("")
      resetForType(addType)
      setFeedback("创建成功")
      onResetType()
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "创建失败")
    } finally {
      setCreating(false)
    }
  }

  const renderField = (field: FieldDef) => (
    <ChannelFormField
      key={field.key}
      id={`create-${addType ?? "channel"}-${field.key}`}
      label={field.label}
      placeholder={field.placeholder}
      type={field.type}
      value={values[field.key] ?? (field.valueKind === "boolean" ? false : "")}
      onChange={(nextValue) => setValue(field.key, nextValue)}
      required={required.includes(field.key)}
      description={field.description}
      options={field.options}
    />
  )

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">新增通知渠道</CardTitle>
            <CardDescription>选择一种桌面端可用渠道，并通过结构化字段完成配置。</CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={onCancelAdd}>
            取消
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {availableTypes.map((type) => {
            const Icon = CHANNEL_ICONS[type]
            return (
              <button
                key={type}
                type="button"
                onClick={() => {
                  onSelectType(type)
                  resetForType(type)
                }}
                className={`flex items-center gap-2 rounded-full border px-3 py-2 text-sm ${addType === type ? "border-primary bg-primary/5" : "border-border bg-background"}`}
              >
                <span className={`flex size-7 items-center justify-center rounded-full ${CHANNEL_COLORS[type]}`}>
                  <Icon className="size-4" />
                </span>
                {CHANNEL_META[type].label}
                {addType === type ? <Badge variant="secondary">当前</Badge> : null}
              </button>
            )
          })}
        </div>

        {addType ? (
          <>
            <div className="space-y-2">
              <label className="text-sm font-medium">显示名称</label>
              <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder={`例如：${CHANNEL_META[addType].label} 主通知`} />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              {fields.map(renderField)}
            </div>
            <div className="text-xs text-muted-foreground">{CHANNEL_META[addType].description}</div>
            {feedback ? <div className="text-xs text-muted-foreground">{feedback}</div> : null}
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => {
                onResetType()
                resetForType(null)
              }}>
                重置类型
              </Button>
              <Button variant="ios-primary" size="sm" onClick={() => void handleCreate()} disabled={creating || !validateConfig(addType)}>
                {creating ? "创建中..." : "创建渠道"}
              </Button>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}
