"use client"

import { useCallback, useEffect, useState } from "react"
import {
  ChevronDown,
  ChevronUp,
  MessageCircleMore,
  RadioTower,
  Send,
  Trash2,
  Settings2,
  Activity,
  Zap,
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
import { cn } from "@/lib/utils"

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
  const desktopImChannel =
    channel.channel === "feishu" ||
    channel.channel === "telegram" ||
    channel.channel === "wechat"
      ? channel.channel
      : null
  const runtimeProfile = desktopImChannel
    ? getPrimaryDesktopImRuntimeProfile(desktopImSnapshot, desktopImChannel)
    : null
  const runtimeResolution = desktopImChannel
    ? getPrimaryDesktopImResolution(desktopImSnapshot, desktopImChannel)
    : null
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
        className={cn(
          "transition-all duration-200",
          muted && "opacity-45"
        )}
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

  const ledColor = channel.is_active
    ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"
    : "bg-slate-400 shadow-none"

  return (
    <>
      <div className="flex flex-col border border-[color:var(--border)] bg-[color:var(--card)] transition-colors hover:bg-muted/30">
        <div className="flex flex-col gap-6 px-6 py-8">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4">
              <div
                className={`flex size-12 shrink-0 items-center justify-center rounded-lg border border-[color:var(--border)] bg-muted/30 ${CHANNEL_COLORS[channel.channel]} text-primary`}
              >
                <Icon className="size-6" />
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <div className={cn("size-1.5 rounded-full", ledColor)} />
                  <h3 className="text-lg font-semibold tracking-tight text-foreground">
                    {channelTitle}
                  </h3>
                </div>
                <div className="mt-1 flex items-center gap-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                  <span>{channelTypeLabel}</span>
                  <span className="text-[color:var(--border)]">|</span>
                  <span>{runtimeLabel}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                System Active
              </span>
              <Switch
                checked={channel.is_active}
                onCheckedChange={() => void handleToggle()}
                disabled={toggling}
                className="scale-75"
              />
            </div>
          </div>

          <div className="grid gap-px overflow-hidden rounded-md border border-[color:var(--border)] bg-[color:var(--border)] sm:grid-cols-3">
            <MetaCell label="Protocol" value={channelTypeLabel} icon={Settings2} />
            <MetaCell
              label="Config Integrity"
              value={configReady ? "Passed" : "Action Required"}
              tone={configReady ? "ok" : "warn"}
              icon={Zap}
            />
            <MetaCell label="Last Active" value={lastUsedLabel} icon={Activity} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-[color:var(--border)] px-6 py-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setExpanded((current) => !current)}
            className="h-8 border-[color:var(--border)] px-3 text-[11px] font-medium"
          >
            {expanded ? <ChevronUp className="mr-1.5 size-3" /> : <ChevronDown className="mr-1.5 size-3" />}
            {expanded ? "CLOSE EDITOR" : "CONFIGURE EXIT"}
          </Button>

          {channel.channel === "wechat" && isDesktopRuntime() && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 border-[color:var(--border)] px-3 text-[11px] font-medium"
                onClick={() => {
                  setWechatDialogOpen(true)
                  if (wechatConnectionState.state === "disconnected") {
                    void handleWechatConnect()
                  }
                }}
              >
                <MessageCircleMore className="mr-2 size-3" />
                WECHAT LINK
              </Button>
              {wechatConnectionState.state === "connected" && (
                <button
                  onClick={() => void handleDisconnectWechat()}
                  className="px-2 text-[10px] font-bold text-destructive uppercase transition-opacity hover:opacity-80"
                >
                  DISCONNECT
                </button>
              )}
            </div>
          )}

          <div className="ml-auto flex gap-2">
            {channel.channel !== "wechat" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleTest}
                disabled={testing || loadingConfig || !configReady}
                className="h-8 text-[11px] font-medium"
              >
                <Send className={cn("mr-1.5 size-3", testing && "animate-spin")} />
                TESTING
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDeleteDialogOpen(true)}
              disabled={deleting}
              className="h-8 text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </div>

        {expanded && (
          <div className="border-t border-[color:var(--border)] bg-muted/10 p-6">
            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                  Instance Alias
                </label>
                <Input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={channelTypeLabel}
                  className="h-10 border-[color:var(--border)] bg-transparent text-sm focus-visible:ring-primary/30"
                />
              </div>

              {channel.channel === "wechat" ? (
                <div className="space-y-6">
                  <div className="grid grid-cols-2 gap-4 rounded-md border border-[color:var(--border)] bg-muted/20 p-4">
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                        Handshake State
                      </span>
                      <div className="flex items-center gap-2">
                        <div
                          className={cn(
                            "size-1.5 rounded-full",
                            wechatConnectionState.state === "connected" ? "bg-emerald-500" : "bg-amber-500",
                          )}
                        />
                        <span className="text-xs font-medium uppercase tracking-tight">
                          {wechatConnectionState.state === "connected"
                            ? wechatConnectionState.accountLabel || "ESTABLISHED"
                            : wechatConnectionState.state === "connecting"
                              ? "HANDSHAKING..."
                              : "IDLE"}
                        </span>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                        Pairing Metadata
                      </span>
                      <div className="flex items-center gap-2 text-xs font-medium">
                        <span className="text-primary">{wechatStats.allowlistSize} NODE(S) ALLOWED</span>
                      </div>
                    </div>
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
                        existing.length > 0 ? `${existing.join("\n")}\n${contactId}` : contactId
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

                  {selectedWechatNotifyContacts.length > 0 && (
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                        Delivery Nodes
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {selectedWechatNotifyContacts.map((contactId) => (
                          <button
                            key={contactId}
                            onClick={() => {
                              const next = selectedWechatNotifyContacts.filter((item) => item !== contactId)
                              setValue("notify_contact_ids", next.join("\n"))
                            }}
                            className="rounded-sm border border-[color:var(--border)] bg-muted/30 px-2 py-1 text-[10px] font-medium transition-colors hover:bg-destructive/10 hover:text-destructive"
                          >
                            {contactId}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="grid gap-6 md:grid-cols-2">{fields.map(renderField)}</div>
                </div>
              ) : channel.channel === "feishu" ? (
                <div className="space-y-6">
                  {FEISHU_FIELD_GROUPS.map((group) => (
                    <div key={group.title} className="space-y-4">
                      <div className="space-y-1">
                        <div className="text-[11px] font-bold uppercase tracking-widest text-primary">
                          {group.title}
                        </div>
                        <div className="text-[11px] text-muted-foreground">{group.description}</div>
                      </div>
                      <div className="grid gap-6 md:grid-cols-2">
                        {group.keys.map((key) => {
                          const field = fields.find((item) => item.key === key)
                          return field ? renderField(field) : null
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid gap-6 md:grid-cols-2">{fields.map(renderField)}</div>
              )}

              <div className="flex justify-end pt-4">
                <Button
                  variant="ios-primary"
                  size="sm"
                  onClick={handleSave}
                  disabled={saving || loadingConfig || !configReady}
                  className="h-9 px-6 font-medium shadow-none"
                >
                  {saving && <RadioTower className="mr-2 size-4 animate-spin" />}
                  SYNC CHANGES
                </Button>
              </div>
              {feedback && (
                <p className="text-center text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  {feedback}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

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
            <AlertDialogTitle>确认删除此通知渠道？</AlertDialogTitle>
            <AlertDialogDescription>
              删除后，绑定此渠道的主动寻猎任务将不再继续向其投递消息。此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDelete()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
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
  icon: Icon,
  className,
}: {
  label: string
  value: string
  tone?: "ok" | "warn"
  icon?: typeof Settings2
  className?: string
}) {
  return (
    <div className={cn("bg-[color:var(--card)] p-4", className)}>
      <div className="flex items-center gap-2">
        {Icon && <Icon className="size-3 text-muted-foreground/60" />}
        <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          {label}
        </div>
      </div>
      <div className={cn(
        "mt-1.5 text-sm font-medium",
        tone === "ok" ? "text-emerald-600" : tone === "warn" ? "text-amber-600" : "text-foreground"
      )}>
        {value}
      </div>
    </div>
  )
}
