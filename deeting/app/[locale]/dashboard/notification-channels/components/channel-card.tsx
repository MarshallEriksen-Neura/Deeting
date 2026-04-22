"use client"

import { useCallback, useEffect, useState } from "react"
import {
  ChevronDown,
  ChevronUp,
  MessageCircleMore,
  RadioTower,
  Send,
  Trash2,
} from "lucide-react"

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
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/shadcn/card"
import { Input } from "@/components/ui/shadcn/input"
import { Switch } from "@/components/ui/shadcn/switch"
import {
  deleteNotificationChannel,
  fetchNotificationChannel,
  testNotificationChannel,
  updateNotificationChannel,
  CHANNEL_META,
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
import {
  buildChannelConfig,
  isFeishuFieldMuted,
  splitStringList,
  validateChannelConfig,
} from "./channel-form-utils"
import { CHANNEL_COLORS, CHANNEL_ICONS, isDesktopRuntime } from "./channel-shared"
import {
  WechatConnectDialog,
  type WechatConnectionViewState,
} from "./wechat-connect-dialog"
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
  const [wechatConnectionState, setWechatConnectionState] =
    useState<WechatConnectionViewState>(() => {
      if (channel.config?.connection_state === "connected") {
        return { state: "connected", accountLabel: channel.config.account_label }
      }
      if (channel.config?.connection_state === "error") {
        return { state: "error", error: "微信连接状态异常" }
      }
      return { state: "disconnected" }
    })

  const Icon = CHANNEL_ICONS[channel.channel]
  const runtimeProfile = getPrimaryDesktopImRuntimeProfile(
    desktopImSnapshot,
    channel.channel,
  )
  const runtimeResolution = getPrimaryDesktopImResolution(
    desktopImSnapshot,
    channel.channel,
  )
  const runtimeLabel = runtimeProfile?.effective_state
    ? `IM ${runtimeProfile.effective_state}`
    : runtimeResolution?.enabled
      ? `IM ${runtimeResolution.resolution.effective}`
      : "未接入 IM"
  const channelTypeLabel = CHANNEL_META[channel.channel]?.label ?? channel.channel
  const channelTitle = channel.display_name?.trim() || channelTypeLabel
  const lastUsedLabel = channel.last_used_at
    ? new Date(channel.last_used_at).toLocaleDateString("zh-CN")
    : "尚未使用"
  const configReady = validateChannelConfig(channel.channel, values)
  const selectedWechatNotifyContacts = splitStringList(
    typeof values.notify_contact_ids === "string" ? values.notify_contact_ids : "",
  )

  const setValue = (key: string, value: ChannelFormValue) =>
    setValues((current) => ({ ...current, [key]: value }))

  useEffect(() => {
    let active = true
    if (!expanded) {
      return () => {
        active = false
      }
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
      } finally {
        if (active) {
          setLoadingConfig(false)
        }
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
        setWechatConnectionState(
          state.state === "connected"
            ? { state: "connected", accountLabel: state.account_label }
            : state.state === "connecting"
              ? { state: "connecting" }
              : state.state === "error"
                ? { state: "error", error: state.last_error || "微信连接异常" }
                : { state: "disconnected" },
        )
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
    if (
      channel.channel !== "wechat" ||
      !wechatPairingId ||
      !wechatDialogOpen ||
      !isDesktopRuntime()
    ) {
      return
    }

    let active = true
    const intervalId = window.setInterval(async () => {
      try {
        const status = await getLocalWechatPairingStatus(wechatPairingId)
        if (!active) return
        if (status.state === "connected") {
          setWechatConnectionState({
            state: "connected",
            accountLabel: status.account_label,
          })
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
          setWechatConnectionState({
            state: "error",
            error: "二维码已过期，请重新生成",
          })
          setWechatPairingId(null)
        } else if (status.state === "cancelled") {
          setWechatConnectionState({ state: "disconnected" })
          setWechatPairingId(null)
        } else if (status.state === "error") {
          setWechatConnectionState({
            state: "error",
            error: status.error || "连接失败",
          })
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
    if (!configReady) return
    setSaving(true)
    setFeedback(null)
    try {
      await updateNotificationChannel(channel.id, {
        config: buildChannelConfig(channel.channel, fields, values, {
          wechatState:
            channel.channel === "wechat"
              ? {
                  state: wechatConnectionState.state,
                  accountLabel:
                    "accountLabel" in wechatConnectionState
                      ? wechatConnectionState.accountLabel
                      : undefined,
                }
              : undefined,
        }),
        display_name: displayName.trim() || undefined,
      })
      setFeedback("已保存")
      await onRefresh()
      setExpanded(false)
    } finally {
      setSaving(false)
    }
  }, [
    channel.channel,
    channel.id,
    configReady,
    displayName,
    fields,
    onRefresh,
    values,
    wechatConnectionState,
  ])

  const handleTest = useCallback(async () => {
    if (!configReady) return
    setTesting(true)
    setFeedback(null)
    try {
      const result = await testNotificationChannel({
        channel: channel.channel,
        config: buildChannelConfig(channel.channel, fields, values, {
          wechatState:
            channel.channel === "wechat"
              ? {
                  state: wechatConnectionState.state,
                  accountLabel:
                    "accountLabel" in wechatConnectionState
                      ? wechatConnectionState.accountLabel
                      : undefined,
                }
              : undefined,
        }),
      })
      setFeedback(result.success ? "测试发送成功" : result.message || "测试发送失败")
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "测试发送失败")
    } finally {
      setTesting(false)
    }
  }, [channel.channel, configReady, fields, values, wechatConnectionState])

  async function handleWechatConnect() {
    setWechatDialogOpen(true)
    setWechatConnectionState({ state: "connecting" })
    try {
      const result = await startLocalWechatPairing()
      setWechatPairingId(result.pairing_id)
      if (result.state === "qr_ready" && result.qr_image_data) {
        setWechatConnectionState({
          state: "qr_ready",
          qrImageData: result.qr_image_data,
          expiresAt: result.expires_at,
        })
        return
      }
      if (result.state === "connected") {
        setWechatConnectionState({
          state: "connected",
          accountLabel: result.account_label,
        })
        if (result.account_label) {
          setValue("account_label", result.account_label)
        }
        setWechatPairingId(null)
        return
      }
      setWechatConnectionState({ state: "connecting" })
    } catch (error) {
      setWechatConnectionState({
        state: "error",
        error: error instanceof Error ? error.message : "连接失败",
      })
      setWechatPairingId(null)
    }
  }

  async function handleWechatCancel() {
    const pairingId = wechatPairingId
    setWechatPairingId(null)
    setWechatConnectionState({ state: "disconnected" })
    if (!pairingId) return
    try {
      await cancelLocalWechatPairing(pairingId)
    } catch {
      // Ignore temporary cancellation failures.
    }
  }

  async function handleWechatDisconnect() {
    try {
      await disconnectLocalWechatChannel(channel.id)
    } catch (error) {
      setWechatConnectionState({
        state: "error",
        error: error instanceof Error ? error.message : "断开失败",
      })
      return
    }
    setWechatPairingId(null)
    setValue("account_label", "")
    setWechatConnectionState({ state: "disconnected" })
  }

  async function handleWechatApprovePairing() {
    if (!wechatPairingCode.trim()) return
    setWechatPairingBusy(true)
    setWechatPairingFeedback(null)
    try {
      const result = await approveLocalWechatPairing(
        channel.id,
        wechatPairingCode.trim(),
      )
      setWechatPairingFeedback(
        result.success
          ? `已批准 ${result.contact_id ?? wechatPairingCode.trim()}`
          : "批准失败",
      )
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

  async function handleWechatRejectPairing() {
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

  async function handleWechatCopyContact(contactId: string) {
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

  const renderField = (field: FieldDef) => {
    const muted = channel.channel === "feishu" && isFeishuFieldMuted(field.key, values)
    const disabled = loadingConfig || muted

    return (
      <div
        key={field.key}
        className={
          muted
            ? "opacity-45 transition-all duration-200"
            : "transition-all duration-200"
        }
      >
        <ChannelFormField
          id={`${channel.channel}-${field.key}`}
          label={field.label}
          placeholder={field.placeholder}
          type={field.type}
          value={values[field.key] ?? (field.valueKind === "boolean" ? false : "")}
          onChange={(nextValue) => setValue(field.key, nextValue)}
          description={field.description}
          options={field.options}
          disabled={disabled}
        />
      </div>
    )
  }

  return (
    <>
      <Card className="group overflow-hidden border-[color:var(--hairline)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--panel-bg)_96%,white_4%)_0%,color-mix(in_srgb,var(--panel-bg)_86%,var(--window-bg)_14%)_100%)] shadow-[var(--elev-floating)] transition-transform duration-[var(--dur-medium)] ease-[var(--ease-standard)] hover:-translate-y-0.5">
        <div className="pointer-events-none h-px w-full bg-[linear-gradient(90deg,transparent,color-mix(in_srgb,var(--accent-strong)_38%,white_62%),transparent)]" />
        <CardHeader className="gap-5">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
            <div className="flex min-w-0 items-start gap-3.5">
              <div
                className={`flex size-12 shrink-0 items-center justify-center rounded-[20px] border border-[color:var(--hairline)] ${CHANNEL_COLORS[channel.channel]} shadow-[var(--ios-button-shadow-soft)]`}
              >
                <Icon className="size-5" />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-base tracking-[-0.03em] text-[color:var(--ink)]">
                    {channelTitle}
                  </CardTitle>
                  <Badge variant={channel.is_active ? "secondary" : "outline"}>
                    {channel.is_active ? "启用中" : "已停用"}
                  </Badge>
                  <Badge variant="outline">{runtimeLabel}</Badge>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-full border border-[color:var(--hairline)] bg-[color:var(--panel-bg)]/82 px-3 py-2 shadow-[var(--ios-button-shadow-soft)] md:justify-end">
              <span className="text-[11px] font-medium tracking-[0.08em] text-[color:var(--ink-4)]">
                运行开关
              </span>
              <Switch
                checked={channel.is_active}
                onCheckedChange={() => void handleToggle()}
                disabled={toggling}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <MetaCell
              label="渠道类型"
              value={channelTypeLabel}
              tone="neutral"
            />
            <MetaCell
              label="配置状态"
              value={configReady ? "结构化就绪" : "字段未完成"}
              tone={configReady ? "ok" : "warn"}
            />
            <MetaCell
              className="sm:col-span-2 xl:col-span-1"
              label="最近使用"
              value={lastUsedLabel}
              tone="neutral"
            />
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setExpanded((current) => !current)}
            >
              {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
              {expanded ? "收起编辑器" : "展开配置"}
            </Button>
            {channel.channel === "wechat" ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setWechatDialogOpen(true)
                  if (wechatConnectionState.state === "disconnected") {
                    void handleWechatConnect()
                  }
                }}
              >
                <MessageCircleMore className="size-4" />
                {wechatConnectionState.state === "connected" ? "查看微信连接" : "连接微信"}
              </Button>
            ) : null}
            <div className="hidden flex-1 sm:block" />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDeleteDialogOpen(true)}
              disabled={deleting}
              className="text-[color:var(--ink-3)] hover:text-[color:var(--danger)]"
            >
              <Trash2 className="size-4" />
              删除
            </Button>
          </div>

          {expanded ? (
            <div className="space-y-4 rounded-[24px] border border-[color:var(--hairline)] bg-[color:var(--panel-bg)]/82 p-4 shadow-[var(--ios-button-shadow-soft)]">
              <div className="space-y-2">
                <label className="text-sm font-medium text-[color:var(--ink)]">
                  显示名称
                </label>
                <Input
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="例如：飞书主通知"
                />
              </div>

              {channel.channel === "wechat" ? (
                <div className="space-y-4">
                  <div className="rounded-[22px] border border-[color:var(--ok-border)] bg-[color:var(--ok-soft)]/60 p-4">
                    <div className="mb-3 flex items-start gap-3">
                      <div className="mt-0.5 flex size-10 items-center justify-center rounded-2xl bg-[color:var(--panel-bg)] text-[color:var(--ok)]">
                        <MessageCircleMore className="size-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-[color:var(--ink)]">
                          微信连接与联系人接入
                        </div>
                        <div className="mt-1 text-[11px] leading-5 text-[color:var(--ink-3)]">
                          这里集中处理扫码连接、pairing code 审批，以及通知联系人维护。
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-[color:var(--hairline)] bg-[color:var(--panel-bg)] px-2.5 py-1 text-[11px] text-[color:var(--ink-3)]">
                        当前状态：{wechatConnectionState.state}
                      </span>
                      {"accountLabel" in wechatConnectionState &&
                      wechatConnectionState.accountLabel ? (
                        <span className="rounded-full border border-[color:var(--ok-border)] bg-[color:var(--panel-bg)] px-2.5 py-1 text-[11px] text-[color:var(--ok)]">
                          {wechatConnectionState.accountLabel}
                        </span>
                      ) : null}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setWechatDialogOpen(true)
                          if (wechatConnectionState.state === "disconnected") {
                            void handleWechatConnect()
                          }
                        }}
                      >
                        <RadioTower className="size-4" />
                        {wechatConnectionState.state === "connected"
                          ? "查看连接"
                          : "开始连接"}
                      </Button>
                    </div>
                    {wechatConnectionState.state === "error" &&
                    "error" in wechatConnectionState ? (
                      <div className="mt-3 rounded-xl border border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] px-3 py-2 text-xs text-[color:var(--danger)]">
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
                      const existing = selectedWechatNotifyContacts
                      if (existing.includes(contactId)) return
                      const nextValue =
                        existing.length > 0
                          ? `${existing.join("\n")}\n${contactId}`
                          : contactId
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
                    <div className="rounded-[22px] border border-[color:var(--info-border)] bg-[color:var(--info-soft)]/56 p-4">
                      <div className="mb-2 text-[11px] font-medium text-[color:var(--ink-3)]">
                        当前通知联系人
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {selectedWechatNotifyContacts.map((contactId) => (
                          <button
                            key={`selected-${contactId}`}
                            type="button"
                            onClick={() => {
                              const next = selectedWechatNotifyContacts.filter(
                                (item) => item !== contactId,
                              )
                              setValue("notify_contact_ids", next.join("\n"))
                            }}
                            className="rounded-full border border-[color:var(--info-border)] bg-[color:var(--panel-bg)] px-2.5 py-1 text-[11px] text-[color:var(--info)]"
                          >
                            {contactId} · 移除
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="grid gap-4">
                    {fields.map(renderField)}
                  </div>
                </div>
              ) : channel.channel === "feishu" ? (
                <div className="space-y-4">
                  {FEISHU_FIELD_GROUPS.map((group) => (
                    <div
                      key={group.title}
                      className="rounded-[22px] border border-[color:var(--hairline)] bg-[color:var(--panel-bg)] p-4"
                    >
                      <div className="mb-3">
                        <div className="text-sm font-semibold text-[color:var(--ink)]">
                          {group.title}
                        </div>
                        <div className="mt-1 text-[11px] text-[color:var(--ink-3)]">
                          {group.description}
                        </div>
                      </div>
                      <div className="grid gap-4">
                        {group.keys.map((key) => {
                          const field = fields.find((item) => item.key === key)
                          return field ? renderField(field) : null
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid gap-4">
                  {fields.map(renderField)}
                </div>
              )}

              {feedback ? (
                <div className="rounded-xl border border-[color:var(--hairline)] bg-[color:var(--panel-bg)]/78 px-3 py-2 text-xs text-[color:var(--ink-3)]">
                  {feedback}
                </div>
              ) : null}

              <div className="flex flex-wrap justify-end gap-2">
                {channel.channel !== "wechat" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleTest()}
                    disabled={testing || loadingConfig || !configReady}
                  >
                    <Send className="size-4" />
                    {testing ? "测试中..." : "测试发送"}
                  </Button>
                ) : null}
                <Button
                  variant="ios-primary"
                  size="sm"
                  onClick={() => void handleSave()}
                  disabled={saving || loadingConfig || !configReady}
                >
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

function MetaCell({
  label,
  value,
  tone,
  className,
}: {
  label: string
  value: string
  tone: "neutral" | "ok" | "warn"
  className?: string
}) {
  const toneClass =
    tone === "ok"
      ? "border-[color:var(--ok-border)] bg-[color:var(--ok-soft)]/56 text-[color:var(--ok)]"
      : tone === "warn"
        ? "border-[color:var(--warn-border)] bg-[color:var(--warn-soft)]/56 text-[color:var(--warn)]"
        : "border-[color:var(--hairline)] bg-[color:var(--panel-bg)]/78 text-[color:var(--ink-2)]"

  return (
    <div className={`rounded-[22px] border px-3.5 py-3 ${toneClass} ${className ?? ""}`}>
      <div className="text-[11px] font-medium tracking-[0.08em] opacity-70">
        {label}
      </div>
      <div className="mt-1.5 text-sm font-semibold leading-5">{value}</div>
    </div>
  )
}
