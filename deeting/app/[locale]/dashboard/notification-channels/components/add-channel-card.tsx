"use client"

import { useEffect, useState } from "react"
import { Plus } from "lucide-react"

import { Badge } from "@/components/ui/shadcn/badge"
import { Button } from "@/components/ui/shadcn/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/shadcn/card"
import { Input } from "@/components/ui/shadcn/input"
import {
  CHANNEL_META,
  type ChannelConfig,
  type ChannelType,
} from "@/lib/api/notification-channels"

import { ChannelFormField } from "./channel-form-field"
import {
  defaultFormValues,
  FIELD_DEFS,
  type ChannelFormValue,
  type FieldDef,
} from "./channel-form-schema"
import { buildChannelConfig, validateChannelConfig } from "./channel-form-utils"
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
  if (!availableTypes.length && !showAdd) {
    return (
      <Card className="overflow-hidden border-[color:var(--hairline)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--panel-bg)_96%,white_4%)_0%,color-mix(in_srgb,var(--ok-soft)_22%,var(--panel-bg)_78%)_100%)] shadow-[var(--elev-floating)]">
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="flex size-11 items-center justify-center rounded-2xl bg-[color:var(--ok-soft)] text-[color:var(--ok)]">
              <Plus className="size-5" />
            </div>
            <div>
              <CardTitle className="text-base text-[color:var(--ink)]">
                当前渠道已接满
              </CardTitle>
            </div>
          </div>
        </CardHeader>
      </Card>
    )
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
    <Card className="overflow-hidden border-[color:var(--hairline)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--panel-bg)_96%,white_4%)_0%,color-mix(in_srgb,var(--accent-soft)_26%,var(--panel-bg)_74%)_100%)] shadow-[var(--elev-floating)]">
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="flex size-11 items-center justify-center rounded-2xl bg-[color:var(--accent-soft)] text-[color:var(--accent-strong)]">
            <Plus className="size-5" />
          </div>
          <div>
            <CardTitle className="text-base text-[color:var(--ink)]">
              新增通知渠道
            </CardTitle>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {availableTypes.map((type) => (
            <div
              key={type}
              className="rounded-full border border-[color:var(--hairline)] bg-[color:var(--panel-bg)]/84 px-3 py-1.5 text-xs text-[color:var(--ink-2)]"
            >
              {CHANNEL_META[type].label}
            </div>
          ))}
        </div>
        <Button variant="ios-primary" onClick={onShowAdd} className="w-full">
          <Plus className="size-4" />
          开始配置新渠道
        </Button>
      </CardContent>
    </Card>
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
  const [values, setValues] = useState<Record<string, ChannelFormValue>>({})

  const fields = addType ? FIELD_DEFS[addType] : []

  useEffect(() => {
    if (!addType) {
      setValues({})
      setDisplayName("")
      return
    }
    setValues({ ...defaultFormValues(addType) })
    setDisplayName("")
    setFeedback(null)
  }, [addType])

  function setValue(key: string, value: ChannelFormValue) {
    setValues((current) => ({ ...current, [key]: value }))
  }

  async function handleCreate() {
    if (!addType || !validateChannelConfig(addType, values)) return
    setCreating(true)
    setFeedback(null)
    try {
      await onCreate(addType, buildChannelConfig(addType, fields, values), displayName)
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
      description={field.description}
      options={field.options}
    />
  )

  return (
    <Card className="overflow-hidden border-[color:var(--hairline)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--panel-bg)_96%,white_4%)_0%,color-mix(in_srgb,var(--panel-bg)_88%,var(--window-bg)_12%)_100%)] shadow-[var(--elev-floating)]">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base text-[color:var(--ink)]">
              新增通知渠道
            </CardTitle>
          </div>
          <Button variant="ghost" size="sm" onClick={onCancelAdd}>
            取消
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-2">
          {availableTypes.map((type) => {
            const Icon = CHANNEL_ICONS[type]
            const active = addType === type

            return (
              <button
                key={type}
                type="button"
                onClick={() => onSelectType(type)}
                className={`group flex items-start gap-3 rounded-[22px] border px-4 py-3 text-left transition-all ${
                  active
                    ? "border-[color:var(--accent-border)] bg-[color:var(--accent-soft)]/80 shadow-[var(--ios-button-shadow-soft)]"
                    : "border-[color:var(--hairline)] bg-[color:var(--panel-bg)]/78 hover:border-[color:var(--accent-border)]/70 hover:bg-[color:var(--accent-soft)]/26"
                }`}
              >
                <div className={`flex size-10 items-center justify-center rounded-2xl ${CHANNEL_COLORS[type]}`}>
                  <Icon className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-[color:var(--ink)]">
                      {CHANNEL_META[type].label}
                    </span>
                    {active ? <Badge variant="secondary">当前</Badge> : null}
                  </div>
                  <div className="mt-1 text-xs leading-5 text-[color:var(--ink-3)]">
                    {CHANNEL_META[type].description}
                  </div>
                </div>
              </button>
            )
          })}
        </div>

        {addType ? (
          <div className="space-y-4 rounded-[24px] border border-[color:var(--hairline)] bg-[color:var(--panel-bg)]/78 p-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-[color:var(--ink)]">
                显示名称
              </label>
              <Input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder={`例如：${CHANNEL_META[addType].label} 主通知`}
              />
            </div>

            <div className="space-y-3">
              {fields.map(renderField)}
            </div>

            {feedback ? (
              <div className="rounded-xl border border-[color:var(--hairline)] bg-[color:var(--panel-bg)]/78 px-3 py-2 text-xs text-[color:var(--ink-3)]">
                {feedback}
              </div>
            ) : null}

            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" size="sm" onClick={onResetType}>
                重置类型
              </Button>
              <Button
                variant="ios-primary"
                size="sm"
                onClick={() => void handleCreate()}
                disabled={creating || !validateChannelConfig(addType, values)}
              >
                {creating ? "创建中..." : "创建渠道"}
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
