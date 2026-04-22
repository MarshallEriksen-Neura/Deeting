"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ChevronDown, ChevronUp, MessageCircleMore, Trash2 } from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/shadcn/alert-dialog"
import { Badge } from "@/components/ui/shadcn/badge"
import { Button } from "@/components/ui/shadcn/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/shadcn/card"
import { Input } from "@/components/ui/shadcn/input"
import { Switch } from "@/components/ui/switch"
import {
  deleteNotificationChannel,
  fetchNotificationChannel,
  testNotificationChannel,
  updateNotificationChannel,
  CHANNEL_REQUIRED_FIELDS,
  type ChannelConfig,
  type NotificationChannel,
} from "@/lib/api/notification-channels"
import {
  getPrimaryDesktopImResolution,
  getPrimaryDesktopImRuntimeProfile,
  type DesktopImSettingsSnapshot,
} from "@/lib/api/desktop-im"
import {
  approveLocalWechatPairing,
  cancelLocalWechatPairing,
  disconnectLocalWechatChannel,
  getLocalWechatConnectionState,
  getLocalWechatPairingStatus,
  rejectLocalWechatPairing,
  startLocalWechatPairing,
} from "@/lib/api/wechat-connection"

import { ChannelFormField } from "./channel-form-field"
import {
  configToFormValues,
  defaultFormValues,
  FEISHU_FIELD_GROUPS,
  FIELD_DEFS,
  type ChannelFormValue,
  type FieldDef,
} from "./channel-form-schema"
import { CHANNEL_COLORS, CHANNEL_ICONS, isDesktopRuntime } from "./channel-shared"
import { WechatConnectDialog, type WechatConnectionViewState } from "./wechat-connect-dialog"
import { WechatPairingPanel } from "./wechat-pairing-panel"

export function ChannelCard({
  channel,
  desktopImSnapshot,
  onRefresh,
}: {
  channel: NotificationChannel
  desktopImSnapshot?: DesktopImSettingsSnapshot | null
  onRefresh: () => void | Promise<unknown>
}) {
  const fields = FIELD_DEFS[channel.channel]
  const required = CHANNEL_REQUIRED_FIELDS[channel.channel]
  const [expanded, setExpanded] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [toggling, setToggling] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [displayName, setDisplayName] = useState(channel.display_name ?? "")
  const [values, setValues] = useState<Record<string, ChannelFormValue>>(() => ({
    ...defaultFormValues(channel.channel),
    ...configToFormValues(fields, channel.config),
  }))
  const [feedback, setFeedback] = useState<string | null>(null)
  const [loadingConfig, setLoadingConfig] = useState(false)
  const [wechatDialogOpen, setWechatDialogOpen] = useState(false)
  const [wechatPairingId, setWechatPairingId] = useState<string | null>(null)
  const [wechatPairingCode, setWechatPairingCode] = useState("")
  const [wechatPairingBusy, setWechatPairingBusy] = useState(false)
  const [wechatPairingFeedback, setWechatPairingFeedback] = useState<string | null>(null)
  const [wechatStats, setWechatStats] = useState({
    pendingPairings: 0,
    allowlistSize: 0,
    allowlistContacts: [] as string[],
    contextContacts: [] as string[],
  })
  const [wechatConnectionState, setWechatConnectionState] = useState<WechatConnectionViewState>(() => {
    if (channel.config?.connection_state === "connected") {
      return { state: "connected", accountLabel: channel.config.account_label }
    }
    if (channel.config?.connection_state === "error") {
      return { state: "error", error: "微信连接状态异常" }
    }
    return { state: "disconnected" }
  })

  const Icon = CHANNEL_ICONS[channel.channel]
  const runtimeProfile = getPrimaryDesktopImRuntimeProfile(desktopImSnapshot, channel.channel)
  const runtimeResolution = getPrimaryDesktopImResolution(desktopImSnapshot, channel.channel)
  const runtimeLabel = runtimeProfile?.effective_state
    ? `IM ${runtimeProfile.effective_state}`
    : runtimeResolution?.enabled
      ? `IM ${runtimeResolution.resolution.effective}`
      : null
  const runtimeMessage = runtimeProfile?.status_message || runtimeResolution?.resolution.user_message

  const setValue = (key: string, val: ChannelFormValue) =>
    setValues((prev) => ({ ...prev, [key]: val }))

  useEffect(() => {
    let active = true
    if (!expanded) return () => {
      active = false
    }

    const load = async () => {
      setLoadingConfig(true)
      try {
        const detail = await fetchNotificationChannel(channel.id)
        if (!active) return
        setValues({
          ...defaultFormValues(channel.channel),
          ...configToFormValues(fields, detail.config),
        })
        setDisplayName(detail.display_name ?? "")
      } catch {
        if (!active) return
      } finally {
        if (active) setLoadingConfig(false)
      }
    }

    void load()
    return () => {
      active = false
    }
  }, [channel.channel, channel.id, expanded, fields])

  useEffect(() => {
    if (channel.channel !== "wechat" || !isDesktopRuntime()) {
      return
    }

    let active = true
    const loadState = async () => {
      try {
        const state = await getLocalWechatConnectionState(channel.id)
        if (!active) return
        if (state.state === "connected") {
          setWechatConnectionState({ state: "connected", accountLabel: state.account_label })
        } else if (state.state === "connecting") {
          setWechatConnectionState({ state: "connecting" })
        } else if (state.state === "error") {
          setWechatConnectionState({ state: "error", error: state.last_error || "微信连接异常" })
        } else {
          setWechatConnectionState({ state: "disconnected" })
        }
        setWechatStats({
          pendingPairings: state.pending_pairings,
          allowlistSize: state.allowlist_size,
          allowlistContacts: state.allowlist_contacts ?? [],
          contextContacts: state.context_contacts ?? [],
        })
      } catch {
        if (active) {
          setWechatConnectionState((current) => current)
        }
      }
    }

    void loadState()
    return () => {
      active = false
    }
  }, [channel.channel, channel.id])

  useEffect(() => {
    if (channel.channel !== "wechat" || !wechatPairingId || !wechatDialogOpen || !isDesktopRuntime()) {
      return
    }

    let active = true
    const intervalId = window.setInterval(async () => {
      try {
        const status = await getLocalWechatPairingStatus(wechatPairingId)
        if (!active) return
        if (status.state === "connected") {
          setWechatConnectionState({ state: "connected", accountLabel: status.account_label })
          setValue("connection_state", "connected")
          if (status.account_label) {
            setValue("account_label", status.account_label)
          }
          setWechatPairingId(null)
        } else if (status.state === "connecting") {
          setWechatConnectionState({ state: "connecting" })
        } else if (status.state === "qr_ready" && status.qr_image_data) {
          setWechatConnectionState({
            state: "qr_ready",
            qrImageData: status.qr_image_data,
            expiresAt: status.expires_at,
          })
        } else if (status.state === "expired") {
          setWechatConnectionState({ state: "error", error: "二维码已过期，请重新生成" })
          setWechatPairingId(null)
        } else if (status.state === "cancelled") {
          setWechatConnectionState({ state: "disconnected" })
          setWechatPairingId(null)
        } else if (status.state === "error") {
          setWechatConnectionState({ state: "error", error: status.error || "连接失败" })
          setWechatPairingId(null)
        }
      } catch (error) {
        if (!active) return
        setWechatConnectionState({
          state: "error",
          error: error instanceof Error ? error.message : "连接失败",
        })
        setWechatPairingId(null)
      }
    }, 2000)

    return () => {
      active = false
      window.clearInterval(intervalId)
    }
  }, [channel.channel, wechatDialogOpen, wechatPairingId])

  const buildConfig = (): ChannelConfig => {
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
        const items = value
          .split(/\r?\n|,/)
          .map((item) => item.trim())
          .filter(Boolean)
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

    if (channel.channel === "wechat") {
      config.access_policy = typeof values.access_policy === "string" && values.access_policy.trim().length > 0 ? (values.access_policy as "pairing" | "allowlist") : "pairing"
      config.im_enabled = Boolean(values.im_enabled)
      config.connection_state = wechatConnectionState.state === "qr_ready" ? "connecting" : wechatConnectionState.state
      if (wechatConnectionState.state === "connected" && wechatConnectionState.accountLabel) {
        config.account_label = wechatConnectionState.accountLabel
      }
      if (typeof values.account_label === "string" && values.account_label.trim().length > 0) {
        config.account_label = values.account_label.trim()
      }
      imConfig.access_policy = config.access_policy
      imConfig.im_enabled = config.im_enabled
      imConfig.connection_state = config.connection_state
      if (config.account_label) {
        imConfig.account_label = config.account_label
      }
    }

    if (channel.channel === "telegram") {
      config.im_enabled = Boolean(values.im_enabled)
      config.media_enabled = Boolean(values.media_enabled)
      imConfig.im_enabled = config.im_enabled
      imConfig.media_enabled = config.media_enabled
    }

    if (channel.channel === "feishu" || channel.channel === "wechat" || channel.channel === "telegram") {
      config.im_config = imConfig
    }

    return config
  }

  const validateConfig = () => {
    if (channel.channel === "wechat") {
      return true
    }
    if (channel.channel === "telegram") {
      const imEnabled = Boolean(values.im_enabled)
      if (!imEnabled) return true
      return required.every((key) => {
        const value = values[key]
        return typeof value === "string" && value.trim().length > 0
      })
    }
    if (channel.channel !== "feishu") {
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

  const handleToggle = useCallback(async () => {
    setToggling(true)
    setFeedback(null)
    try {
      await updateNotificationChannel(channel.id, { is_active: !channel.is_active })
      await onRefresh()
    } finally {
      setToggling(false)
    }
  }, [channel.id, channel.is_active, onRefresh])

  const handleDelete = useCallback(async () => {
    setDeleting(true)
    setFeedback(null)
    try {
      await deleteNotificationChannel(channel.id)
      await onRefresh()
      setDeleteDialogOpen(false)
    } finally {
      setDeleting(false)
    }
  }, [channel.id, onRefresh])

  const handleSave = useCallback(async () => {
    if (!validateConfig()) return
    setSaving(true)
    setFeedback(null)
    try {
      await updateNotificationChannel(channel.id, {
        config: buildConfig(),
        display_name: displayName.trim() || undefined,
      })
      setFeedback("已保存")
      await onRefresh()
      setExpanded(false)
    } finally {
      setSaving(false)
    }
  }, [channel.id, displayName, onRefresh, values, wechatConnectionState])

  const handleTest = useCallback(async () => {
    if (!validateConfig()) return
    setTesting(true)
    setFeedback(null)
    try {
      const result = await testNotificationChannel({
        channel: channel.channel,
        config: buildConfig(),
      })
      setFeedback(result.success ? "测试发送成功" : result.message || "测试发送失败")
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "测试发送失败")
    } finally {
      setTesting(false)
    }
  }, [channel.channel, values, wechatConnectionState])

  const handleWechatConnect = async () => {
    setWechatDialogOpen(true)
    setWechatConnectionState({ state: "connecting" })
    try {
      const result = await startLocalWechatPairing()
      setWechatPairingId(result.pairing_id)
      if (result.state === "qr_ready" && result.qr_image_data) {
        setWechatConnectionState({ state: "qr_ready", qrImageData: result.qr_image_data, expiresAt: result.expires_at })
        return
      }
      if (result.state === "connected") {
        setWechatConnectionState({ state: "connected", accountLabel: result.account_label })
        if (result.account_label) {
          setValue("account_label", result.account_label)
        }
        setValue("connection_state", "connected")
        setWechatPairingId(null)
        return
      }
      setWechatConnectionState({ state: "connecting" })
    } catch (error) {
      setWechatConnectionState({ state: "error", error: error instanceof Error ? error.message : "连接失败" })
      setWechatPairingId(null)
    }
  }

  const handleWechatCancel = async () => {
    const pairingId = wechatPairingId
    setWechatPairingId(null)
    setWechatConnectionState({ state: "disconnected" })
    if (!pairingId) return
    try {
      await cancelLocalWechatPairing(pairingId)
    } catch {
      // ignore temporary cancellation errors
    }
  }

  const handleWechatDisconnect = async () => {
    try {
      await disconnectLocalWechatChannel(channel.id)
    } catch (error) {
      setWechatConnectionState({ state: "error", error: error instanceof Error ? error.message : "断开失败" })
      return
    }
    setWechatPairingId(null)
    setValue("account_label", "")
    setValue("connection_state", "disconnected")
    setWechatConnectionState({ state: "disconnected" })
  }

  const handleWechatApprovePairing = async () => {
    if (!wechatPairingCode.trim()) return
    setWechatPairingBusy(true)
    setWechatPairingFeedback(null)
    try {
      const result = await approveLocalWechatPairing(channel.id, wechatPairingCode.trim())
      setWechatPairingFeedback(result.success ? `已批准 ${result.contact_id ?? wechatPairingCode.trim()}` : "批准失败")
      setWechatPairingCode("")
      const state = await getLocalWechatConnectionState(channel.id)
      setWechatStats({
        pendingPairings: state.pending_pairings,
        allowlistSize: state.allowlist_size,
        allowlistContacts: state.allowlist_contacts ?? [],
        contextContacts: state.context_contacts ?? [],
      })
    } catch (error) {
      setWechatPairingFeedback(error instanceof Error ? error.message : "批准失败")
    } finally {
      setWechatPairingBusy(false)
    }
  }

  const handleWechatRejectPairing = async () => {
    if (!wechatPairingCode.trim()) return
    setWechatPairingBusy(true)
    setWechatPairingFeedback(null)
    try {
      await rejectLocalWechatPairing(channel.id, wechatPairingCode.trim())
      setWechatPairingFeedback("已拒绝该 pairing code")
      setWechatPairingCode("")
      const state = await getLocalWechatConnectionState(channel.id)
      setWechatStats({
        pendingPairings: state.pending_pairings,
        allowlistSize: state.allowlist_size,
        allowlistContacts: state.allowlist_contacts ?? [],
        contextContacts: state.context_contacts ?? [],
      })
    } catch (error) {
      setWechatPairingFeedback(error instanceof Error ? error.message : "拒绝失败")
    } finally {
      setWechatPairingBusy(false)
    }
  }

  const handleWechatCopyContact = async (contactId: string) => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(contactId)
        setWechatPairingFeedback(`已复制 ${contactId}`)
      } else {
        setWechatPairingFeedback("当前环境不支持复制")
      }
    } catch (error) {
      setWechatPairingFeedback(error instanceof Error ? error.message : "复制失败")
    }
  }

  const isFieldMuted = (fieldKey: string) => {
    if (channel.channel !== "feishu") return false
    if (["bot_app_id", "bot_app_secret"].includes(fieldKey)) {
      return !Boolean(values.im_enabled) || values.transport_preference === "relay"
    }
    if (["relay_base_url", "relay_shared_secret"].includes(fieldKey)) {
      return !Boolean(values.im_enabled) || values.transport_preference === "direct"
    }
    return false
  }

  const renderField = (field: FieldDef) => {
    const muted = isFieldMuted(field.key)
    const disabled = loadingConfig || muted

    return (
      <div key={field.key} className={muted ? "opacity-45 transition-all" : "transition-all"}>
        <ChannelFormField
          id={`${channel.channel}-${field.key}`}
          label={field.label}
          placeholder={field.placeholder}
          type={field.type}
          value={values[field.key] ?? (field.valueKind === "boolean" ? false : "")}
          onChange={(nextValue) => setValue(field.key, nextValue)}
          required={required.includes(field.key)}
          description={field.description}
          options={field.options}
          disabled={disabled}
        />
      </div>
    )
  }

  const selectedWechatNotifyContacts = typeof values.notify_contact_ids === "string"
    ? values.notify_contact_ids.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean)
    : []

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className={`flex size-11 shrink-0 items-center justify-center rounded-2xl ${CHANNEL_COLORS[channel.channel]}`}>
              <Icon className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <CardTitle className="text-base">{channel.display_name || channel.channel}</CardTitle>
              <CardDescription className="mt-1">
                类型：{channel.channel}
                {channel.last_used_at ? ` · 最近使用 ${new Date(channel.last_used_at).toLocaleDateString("zh-CN")}` : ""}
              </CardDescription>
              {runtimeLabel ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline">{runtimeLabel}</Badge>
                  {runtimeMessage ? <span>{runtimeMessage}</span> : null}
                </div>
              ) : null}
            </div>
            <CardAction className="flex items-center gap-2">
              <Badge variant={channel.is_active ? "secondary" : "outline"}>
                {channel.is_active ? "启用" : "停用"}
              </Badge>
              <Switch checked={channel.is_active} onCheckedChange={() => void handleToggle()} disabled={toggling} />
            </CardAction>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setExpanded((current) => !current)}>
              {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
              {expanded ? "收起" : "编辑配置"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDeleteDialogOpen(true)} disabled={deleting}>
              <Trash2 className="size-4" />
              删除
            </Button>
          </div>

          {expanded ? (
            <div className="space-y-4 rounded-2xl border border-border/60 bg-muted/20 p-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">显示名称</label>
                <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="例如：飞书主通知" />
              </div>

              {channel.channel === "wechat" ? (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                    <div className="mb-3 flex items-start gap-3">
                      <div className="mt-0.5 rounded-xl bg-emerald-500/10 p-2 text-emerald-600">
                        <MessageCircleMore className="size-3.5" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-foreground">微信连接</div>
                        <div className="mt-1 text-[11px] leading-5 text-muted-foreground">扫码连接桌面端微信账号，建立联系人上下文和配对审批能力。</div>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-background px-2.5 py-1 text-[11px] text-muted-foreground">当前状态：{wechatConnectionState.state}</span>
                      {wechatConnectionState.state === "connected" && "accountLabel" in wechatConnectionState && wechatConnectionState.accountLabel ? (
                        <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-700">{wechatConnectionState.accountLabel}</span>
                      ) : null}
                      <Button type="button" size="sm" variant="outline" onClick={() => {
                        setWechatDialogOpen(true)
                        if (wechatConnectionState.state === "disconnected") {
                          void handleWechatConnect()
                        }
                      }}>
                        {wechatConnectionState.state === "connected" ? "查看连接" : "连接微信"}
                      </Button>
                    </div>
                    {wechatConnectionState.state === "error" && "error" in wechatConnectionState ? (
                      <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-700">
                        {wechatConnectionState.error}
                      </div>
                    ) : null}
                  </div>

                  <WechatPairingPanel
                    pendingPairings={wechatStats.pendingPairings}
                    allowlistSize={wechatStats.allowlistSize}
                    allowlistContacts={wechatStats.allowlistContacts}
                    contextContacts={wechatStats.contextContacts}
                    pairingCode={wechatPairingCode}
                    onPairingCodeChange={setWechatPairingCode}
                    onUseContact={(contactId) => {
                      const currentValue = typeof values.notify_contact_ids === "string" ? values.notify_contact_ids : ""
                      const existing = currentValue.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean)
                      if (existing.includes(contactId)) return
                      const nextValue = existing.length > 0 ? `${existing.join("\n")}\n${contactId}` : contactId
                      setValue("notify_contact_ids", nextValue)
                    }}
                    onCopyContact={(contactId) => {
                      void handleWechatCopyContact(contactId)
                    }}
                    onApprove={() => {
                      void handleWechatApprovePairing()
                    }}
                    onReject={() => {
                      void handleWechatRejectPairing()
                    }}
                    busy={wechatPairingBusy}
                    feedback={wechatPairingFeedback}
                  />

                  {selectedWechatNotifyContacts.length > 0 ? (
                    <div className="rounded-2xl border border-sky-500/20 bg-sky-500/5 p-4">
                      <div className="mb-2 text-[11px] font-medium text-muted-foreground">当前通知联系人</div>
                      <div className="flex flex-wrap gap-2">
                        {selectedWechatNotifyContacts.map((contactId) => (
                          <button
                            key={`selected-${contactId}`}
                            type="button"
                            onClick={() => {
                              const next = selectedWechatNotifyContacts.filter((item) => item !== contactId)
                              setValue("notify_contact_ids", next.join("\n"))
                            }}
                            className="rounded-full border border-sky-500/20 bg-sky-500/10 px-2.5 py-1 text-[11px] text-sky-700"
                          >
                            {contactId} · 移除
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {fields.map(renderField)}
                </div>
              ) : channel.channel === "feishu" ? (
                <div className="space-y-4">
                  {FEISHU_FIELD_GROUPS.map((group) => (
                    <div key={group.title} className="rounded-2xl border border-border/60 bg-background p-4">
                      <div className="mb-3">
                        <div className="text-sm font-semibold">{group.title}</div>
                        <div className="mt-1 text-[11px] text-muted-foreground">{group.description}</div>
                      </div>
                      <div className="space-y-3">
                        {group.keys.map((key) => {
                          const field = fields.find((item) => item.key === key)
                          return field ? renderField(field) : null
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                fields.map(renderField)
              )}

              {feedback ? <div className="text-xs text-muted-foreground">{feedback}</div> : null}
              <div className="flex flex-wrap justify-end gap-2">
                {channel.channel !== "wechat" ? (
                  <Button variant="outline" size="sm" onClick={() => void handleTest()} disabled={testing || loadingConfig || !validateConfig()}>
                    {testing ? "测试中..." : "测试发送"}
                  </Button>
                ) : null}
                <Button variant="ios-primary" size="sm" onClick={() => void handleSave()} disabled={saving || loadingConfig || !validateConfig()}>
                  {saving ? "保存中..." : "保存"}
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <WechatConnectDialog
        open={wechatDialogOpen}
        onOpenChange={setWechatDialogOpen}
        state={wechatConnectionState}
        onStartConnect={() => {
          void handleWechatConnect()
        }}
        onReconnect={() => {
          void handleWechatConnect()
        }}
        onDisconnect={() => {
          void handleWechatDisconnect()
        }}
        onCancelPairing={() => {
          void handleWechatCancel()
        }}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除通知渠道？</AlertDialogTitle>
            <AlertDialogDescription>
              删除后，绑定此渠道的主动寻猎任务将不再继续向它投递消息。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleDelete()}>
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
