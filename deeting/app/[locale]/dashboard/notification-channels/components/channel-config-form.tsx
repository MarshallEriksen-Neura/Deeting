"use client"

import { useEffect, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { CheckCircle2, Loader2, MessageCircleMore, Send, Sparkles, XCircle } from "lucide-react"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import { GlassButton } from "@/components/ui/glass-button"
import { CHANNEL_REQUIRED_FIELDS, fetchNotificationChannel, testNotificationChannel } from "@/lib/api/notification-channels"
import type { ChannelConfig, ChannelType } from "@/lib/api/notification-channels"
import { getDesktopImSettings, getPrimaryDesktopImResolution } from "@/lib/api/desktop-im"
import {
  approveLocalWechatPairing,
  cancelLocalWechatPairing,
  disconnectLocalWechatChannel,
  getLocalWechatConnectionState,
  getLocalWechatPairingStatus,
  rejectLocalWechatPairing,
  startLocalWechatPairing,
} from "@/lib/api/wechat-connection"
import { WechatConnectDialog, type WechatConnectionViewState } from "./wechat-connect-dialog"
import { WechatPairingPanel } from "./wechat-pairing-panel"
import { ChannelFormField } from "./channel-form-field"
import {
  configToFormValues,
  defaultFormValues,
  FEISHU_FIELD_GROUPS,
  FIELD_DEFS,
  type ChannelFormValue,
  type FieldDef,
} from "./channel-form-schema"
import { isDesktopRuntime } from "./channel-shared"

export function ChannelConfigForm({
  channelType,
  channelId,
  initialConfig,
  initialDisplayName,
  onSave,
  onCancel,
  showTest,
}: {
  channelType: ChannelType
  channelId?: string
  initialConfig?: ChannelConfig
  initialDisplayName?: string
  onSave: (config: ChannelConfig, displayName: string) => Promise<void>
  onCancel: () => void
  showTest?: boolean
}) {
  const t = useTranslations("dashboard.notificationChannelsPage")
  const fields = FIELD_DEFS[channelType]
  const required = CHANNEL_REQUIRED_FIELDS[channelType]

  const [values, setValues] = useState<Record<string, ChannelFormValue>>(() => ({
    ...defaultFormValues(channelType),
    ...configToFormValues(fields, initialConfig),
  }))
  const [displayName, setDisplayName] = useState(initialDisplayName ?? "")
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [loadingConfig, setLoadingConfig] = useState(false)
  const [testResult, setTestResult] = useState<{
    success: boolean
    message: string | null
  } | null>(null)
  const [imRuntimeHint, setImRuntimeHint] = useState<{
    enabled: boolean
    effective: string
    message: string
  } | null>(null)
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
    if (initialConfig?.connection_state === "connected") {
      return {
        state: "connected",
        accountLabel: initialConfig.account_label,
      }
    }
    if (initialConfig?.connection_state === "error") {
      return {
        state: "error",
        error: t("wechat.errors.stateAbnormal"),
      }
    }
    return { state: "disconnected" }
  })

  const setValue = (key: string, val: ChannelFormValue) =>
    setValues((prev) => ({ ...prev, [key]: val }))

  useEffect(() => {
    let active = true
    if (!channelId) {
      setValues(configToFormValues(fields, initialConfig))
      return () => {
        active = false
      }
    }

    const load = async () => {
      setLoadingConfig(true)
      try {
        const detail = await fetchNotificationChannel(channelId)
        if (!active) return
        setValues({
          ...defaultFormValues(channelType),
          ...configToFormValues(fields, detail.config),
        })
        setDisplayName(detail.display_name ?? "")
      } catch {
        if (!active) return
        setValues({
          ...defaultFormValues(channelType),
          ...configToFormValues(fields, initialConfig),
        })
      } finally {
        if (active) setLoadingConfig(false)
      }
    }

    void load()
    return () => {
      active = false
    }
  }, [channelId, channelType, fields, initialConfig])

  useEffect(() => {
    let active = true

    if (channelType !== "wechat") {
      setWechatConnectionState((current) => {
        if (current.state === "disconnected") {
          return current
        }
        return { state: "disconnected" }
      })
      return () => {
        active = false
      }
    }

    if (
      initialConfig?.connection_state === "connected" ||
      initialConfig?.connection_state === "connecting" ||
      initialConfig?.connection_state === "error"
    ) {
      if (initialConfig.connection_state === "connected") {
        setWechatConnectionState({
          state: "connected",
          accountLabel: initialConfig.account_label,
        })
      } else if (initialConfig.connection_state === "connecting") {
        setWechatConnectionState({ state: "connecting" })
      } else {
        setWechatConnectionState({
          state: "error",
          error: t("wechat.errors.stateAbnormal"),
        })
      }
    } else {
      setWechatConnectionState({ state: "disconnected" })
    }

    if (!channelId || !isDesktopRuntime()) {
      return () => {
        active = false
      }
    }

    const loadState = async () => {
      try {
        const state = await getLocalWechatConnectionState(channelId)
        if (!active) return
        if (state.state === "connected") {
          setWechatConnectionState({
            state: "connected",
            accountLabel: state.account_label,
          })
        } else if (state.state === "connecting") {
          setWechatConnectionState({ state: "connecting" })
        } else if (state.state === "error") {
          setWechatConnectionState({
            state: "error",
            error: state.last_error || t("wechat.errors.stateAbnormal"),
          })
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
  }, [channelType, channelId, initialConfig, t])

  useEffect(() => {
    if (channelType !== "wechat" || !wechatPairingId || !wechatDialogOpen || !isDesktopRuntime()) {
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
          setValue("connection_state", "connected")
          if (status.account_label) {
            setValue("account_label", status.account_label)
          }
          setWechatPairingId(null)
          if (channelId) {
            try {
              const state = await getLocalWechatConnectionState(channelId)
              if (!active) return
              setWechatStats({
                pendingPairings: state.pending_pairings,
                allowlistSize: state.allowlist_size,
                allowlistContacts: state.allowlist_contacts ?? [],
                contextContacts: state.context_contacts ?? [],
              })
            } catch {
              // ignore polling fetch errors
            }
          }
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
            error: t("wechat.errors.qrExpired"),
          })
          setWechatPairingId(null)
        } else if (status.state === "cancelled") {
          setWechatConnectionState({ state: "disconnected" })
          setWechatPairingId(null)
        } else if (status.state === "error") {
          setWechatConnectionState({
            state: "error",
            error: status.error || t("wechat.errors.connectFailed"),
          })
          setWechatPairingId(null)
        }
      } catch (error) {
        if (!active) return
        setWechatConnectionState({
          state: "error",
          error: error instanceof Error ? error.message : t("wechat.errors.connectFailed"),
        })
        setWechatPairingId(null)
      }
    }, 2000)

    return () => {
      active = false
      window.clearInterval(intervalId)
    }
  }, [channelId, channelType, t, wechatDialogOpen, wechatPairingId])

  useEffect(() => {
    let active = true
    const shouldLoadRuntimeHint = channelType === "feishu" || channelType === "telegram"
    if (!shouldLoadRuntimeHint || !isDesktopRuntime()) {
      setImRuntimeHint(null)
      return () => {
        active = false
      }
    }

    const loadRuntimeHint = async () => {
      try {
        const snapshot = await getDesktopImSettings()
        const resolution = getPrimaryDesktopImResolution(snapshot, channelType)
        if (!active) return
        if (resolution) {
          setImRuntimeHint({
            enabled: resolution.enabled,
            effective: resolution.resolution.effective,
            message: resolution.resolution.user_message,
          })
        } else {
          setImRuntimeHint(null)
        }
      } catch {
        if (active) {
          setImRuntimeHint(null)
        }
      }
    }

    void loadRuntimeHint()
    return () => {
      active = false
    }
  }, [channelType, channelId, initialConfig])

  const buildConfig = (): ChannelConfig => {
    const config: ChannelConfig = {}
    for (const field of fields) {
      const value = values[field.key]
      if (field.valueKind === "boolean") {
        ;(config as Record<string, unknown>)[field.key] = Boolean(value)
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
        }
        continue
      }
      if (field.type === "number" || field.valueKind === "number") {
        const parsed = parseInt(value, 10)
        if (Number.isFinite(parsed)) {
          ;(config as Record<string, unknown>)[field.key] = parsed
        }
        continue
      }
      const normalized = value.trim()
      if (normalized) {
        ;(config as Record<string, unknown>)[field.key] = normalized
      }
    }
    if (channelType === "wechat") {
      config.access_policy =
        typeof values.access_policy === "string" && values.access_policy.trim().length > 0
          ? (values.access_policy as "pairing" | "allowlist")
          : "pairing"
      config.im_enabled = Boolean(values.im_enabled)
      config.connection_state =
        wechatConnectionState.state === "qr_ready" ? "connecting" : wechatConnectionState.state
      if (wechatConnectionState.state === "connected" && wechatConnectionState.accountLabel) {
        config.account_label = wechatConnectionState.accountLabel
      }
      if (typeof values.account_label === "string" && values.account_label.trim().length > 0) {
        config.account_label = values.account_label.trim()
      }
    }
    return config
  }

  const validateConfig = () => {
    if (channelType === "wechat") {
      return true
    }
    if (channelType !== "feishu") {
      return required.every((key) => {
        const value = values[key]
        return typeof value === "string" && value.trim().length > 0
      })
    }
    const hasWebhook = typeof values.webhook_url === "string" && values.webhook_url.trim().length > 0
    const imEnabled = Boolean(values.im_enabled)
    const preference =
      (typeof values.transport_preference === "string" && values.transport_preference) || "auto"
    const hasDirectCreds =
      typeof values.bot_app_id === "string" &&
      values.bot_app_id.trim().length > 0 &&
      typeof values.bot_app_secret === "string" &&
      values.bot_app_secret.trim().length > 0
    const hasRelayBaseUrl =
      typeof values.relay_base_url === "string" && values.relay_base_url.trim().length > 0

    if (!hasWebhook && !imEnabled) return false
    if (!imEnabled) return true
    if (preference === "direct") return hasDirectCreds
    if (preference === "relay") return hasRelayBaseUrl
    return hasDirectCreds || hasRelayBaseUrl
  }

  const handleWechatConnect = async () => {
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
        setValue("connection_state", "connected")
        setWechatPairingId(null)
        return
      }
      setWechatConnectionState({ state: "connecting" })
    } catch (error) {
      setWechatConnectionState({
        state: "error",
        error: error instanceof Error ? error.message : t("wechat.errors.connectFailed"),
      })
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
      // ignore temporary cancellation errors and let UI recover locally
    }
  }

  const handleWechatDisconnect = async () => {
    if (channelId && isDesktopRuntime()) {
      try {
        await disconnectLocalWechatChannel(channelId)
      } catch (error) {
        setWechatConnectionState({
          state: "error",
          error: error instanceof Error ? error.message : t("wechat.errors.disconnectFailed"),
        })
        return
      }
    }
    setWechatPairingId(null)
    setValue("account_label", "")
    setValue("connection_state", "disconnected")
    setWechatConnectionState({ state: "disconnected" })
  }

  const handleWechatApprovePairing = async () => {
    if (!channelId || !isDesktopRuntime() || !wechatPairingCode.trim()) return
    setWechatPairingBusy(true)
    setWechatPairingFeedback(null)
    try {
      const result = await approveLocalWechatPairing(channelId, wechatPairingCode.trim())
      setWechatPairingFeedback(
        result.success
          ? t("wechatPairing.approved", { contactId: result.contact_id ?? "" }).trim()
          : t("wechatPairing.approveFailed")
      )
      setWechatPairingCode("")
      const state = await getLocalWechatConnectionState(channelId)
      setWechatStats({
        pendingPairings: state.pending_pairings,
        allowlistSize: state.allowlist_size,
        allowlistContacts: state.allowlist_contacts ?? [],
        contextContacts: state.context_contacts ?? [],
      })
    } catch (error) {
      setWechatPairingFeedback(error instanceof Error ? error.message : t("wechatPairing.approveFailed"))
    } finally {
      setWechatPairingBusy(false)
    }
  }

  const handleWechatRejectPairing = async () => {
    if (!channelId || !isDesktopRuntime() || !wechatPairingCode.trim()) return
    setWechatPairingBusy(true)
    setWechatPairingFeedback(null)
    try {
      await rejectLocalWechatPairing(channelId, wechatPairingCode.trim())
      setWechatPairingFeedback(t("wechatPairing.rejected"))
      setWechatPairingCode("")
      const state = await getLocalWechatConnectionState(channelId)
      setWechatStats({
        pendingPairings: state.pending_pairings,
        allowlistSize: state.allowlist_size,
        allowlistContacts: state.allowlist_contacts ?? [],
        contextContacts: state.context_contacts ?? [],
      })
    } catch (error) {
      setWechatPairingFeedback(error instanceof Error ? error.message : t("wechatPairing.rejectFailed"))
    } finally {
      setWechatPairingBusy(false)
    }
  }

  const isValid = validateConfig()
  const isFeishuImEnabled = channelType === "feishu" ? Boolean(values.im_enabled) : false
  const transportPreference =
    channelType === "feishu" && typeof values.transport_preference === "string"
      ? values.transport_preference
      : "auto"

  const handleSave = async () => {
    if (!isValid) return
    setSaving(true)
    try {
      await onSave(buildConfig(), displayName.trim())
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await testNotificationChannel({
        channel: channelType,
        config: buildConfig(),
      })
      setTestResult(result)
    } catch (error: unknown) {
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : t("test.failed"),
      })
    } finally {
      setTesting(false)
    }
  }

  const isFieldMuted = (fieldKey: string) => {
    if (channelType !== "feishu") return false
    if (["bot_app_id", "bot_app_secret"].includes(fieldKey)) {
      return !isFeishuImEnabled || transportPreference === "relay"
    }
    if (["relay_base_url", "relay_shared_secret"].includes(fieldKey)) {
      return !isFeishuImEnabled || transportPreference === "direct"
    }
    if (fieldKey === "bot_system_prompt") {
      return !isFeishuImEnabled
    }
    return false
  }

  const resolveFieldDescription = (field: FieldDef) => {
    return field.descriptionKey ? t(field.descriptionKey) : undefined
  }

  const resolveFieldOptions = (field: FieldDef) => {
    return field.options?.map((option) => ({
      value: option.value,
      label: t(option.labelKey),
    }))
  }

  const renderField = (field: FieldDef) => {
    const muted = isFieldMuted(field.key)
    const disabled = loadingConfig || muted

    return (
      <div key={field.key} className={cn("transition-all", muted && "opacity-45")}>
        <ChannelFormField
          id={`${channelType}-${field.key}`}
          label={t(field.labelKey)}
          placeholder={t(field.placeholderKey)}
          type={field.type}
          value={values[field.key] ?? (field.valueKind === "boolean" ? false : "")}
          onChange={(nextValue) => setValue(field.key, nextValue)}
          required={required.includes(field.key)}
          description={resolveFieldDescription(field)}
          options={resolveFieldOptions(field)}
          disabled={disabled}
        />
      </div>
    )
  }

  const resolveWechatStateLabel = () => {
    if (wechatConnectionState.state === "connected") return t("wechat.status.connected")
    if (wechatConnectionState.state === "connecting" || wechatConnectionState.state === "qr_ready") {
      return t("wechat.status.connecting")
    }
    if (wechatConnectionState.state === "error") return t("wechat.status.error")
    return t("wechat.status.disconnected")
  }

  const resolveTransportLabel = () => {
    if (transportPreference === "direct") return t("fieldOptions.transport.direct")
    if (transportPreference === "relay") return t("fieldOptions.transport.relay")
    return t("fieldOptions.transport.auto")
  }

  const selectedWechatNotifyContacts =
    typeof values.notify_contact_ids === "string"
      ? values.notify_contact_ids
          .split(/\r?\n|,/)
          .map((item) => item.trim())
          .filter(Boolean)
      : []

  const handleWechatCopyContact = async (contactId: string) => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(contactId)
        setWechatPairingFeedback(t("wechatPairing.copied", { contactId }))
      } else {
        setWechatPairingFeedback(t("wechatPairing.copyUnavailable"))
      }
    } catch (error) {
      setWechatPairingFeedback(
        error instanceof Error ? error.message : t("wechatPairing.copyFailed")
      )
    }
  }

  return (
    <div className="space-y-3">
      <ChannelFormField
        id={`${channelType}-display-name`}
        label={t("fields.shared.displayName.label")}
        placeholder={t("fields.shared.displayName.placeholder", {
          channel: t(`channelTypes.${channelType}.label`),
        })}
        value={displayName}
        onChange={(nextValue) =>
          setDisplayName(typeof nextValue === "string" ? nextValue : String(nextValue))
        }
      />

      {channelType === "wechat" ? (
        <div className="space-y-4">
          <div className="rounded-2xl border border-white/8 bg-[var(--foreground)]/[0.02] p-4">
            <div className="mb-3 flex items-start gap-3">
              <div className="mt-0.5 rounded-xl bg-emerald-500/10 p-2 text-emerald-400">
                <MessageCircleMore className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-[var(--foreground)]">
                  {t("wechat.connectCard.title")}
                </div>
                <div className="mt-1 text-[11px] leading-5 text-[var(--muted)]">
                  {t("wechat.connectCard.description")}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-white/5 px-2.5 py-1 text-[11px] text-[var(--muted)]">
                {t("wechat.connectCard.currentStatus")}
                {resolveWechatStateLabel()}
              </span>
              {wechatConnectionState.state === "connected" && wechatConnectionState.accountLabel ? (
                <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-300">
                  {wechatConnectionState.accountLabel}
                </span>
              ) : null}
              <GlassButton
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => {
                  setWechatDialogOpen(true)
                  if (wechatConnectionState.state === "disconnected") {
                    void handleWechatConnect()
                  }
                }}
              >
                {wechatConnectionState.state === "connected"
                  ? t("wechat.actions.viewConnection")
                  : t("wechat.actions.connect")}
              </GlassButton>
            </div>
            {wechatConnectionState.state === "error" ? (
              <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                {wechatConnectionState.error}
              </div>
            ) : null}
          </div>
          {channelId && isDesktopRuntime() ? (
            <WechatPairingPanel
              pendingPairings={wechatStats.pendingPairings}
              allowlistSize={wechatStats.allowlistSize}
              allowlistContacts={wechatStats.allowlistContacts}
              contextContacts={wechatStats.contextContacts}
              pairingCode={wechatPairingCode}
              onPairingCodeChange={setWechatPairingCode}
              onUseContact={(contactId) => {
                const currentValue =
                  typeof values.notify_contact_ids === "string"
                    ? values.notify_contact_ids
                    : ""
                const existing = currentValue
                  .split(/\r?\n|,/)
                  .map((item) => item.trim())
                  .filter(Boolean)
                if (existing.includes(contactId)) {
                  return
                }
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
          ) : null}
          {selectedWechatNotifyContacts.length > 0 ? (
            <div className="rounded-2xl border border-white/8 bg-[var(--foreground)]/[0.02] p-4">
              <div className="mb-2 text-[11px] font-medium text-[var(--muted)]">
                {t("wechat.selectedNotifyContacts")}
              </div>
              <div className="flex flex-wrap gap-2">
                {selectedWechatNotifyContacts.map((contactId) => (
                  <button
                    key={`selected-${contactId}`}
                    type="button"
                    onClick={() => {
                      const next = selectedWechatNotifyContacts.filter((item) => item !== contactId)
                      setValue("notify_contact_ids", next.join("\n"))
                    }}
                    className="rounded-full border border-sky-500/20 bg-sky-500/10 px-2.5 py-1 text-[11px] text-sky-300"
                  >
                    {contactId} · {t("wechat.removeSelectedContact")}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {fields.map(renderField)}
        </div>
      ) : channelType === "feishu" ? (
        <div className="space-y-4">
          {FEISHU_FIELD_GROUPS.map((group) => (
            <div
              key={group.titleKey}
              className="rounded-2xl border border-white/8 bg-[var(--foreground)]/[0.02] p-4"
            >
              <div className="mb-3 flex items-start gap-3">
                <div className="mt-0.5 rounded-xl bg-[var(--primary)]/10 p-2 text-[var(--primary)]">
                  <Sparkles className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[var(--foreground)]">
                    {t(group.titleKey)}
                  </div>
                  <div className="mt-1 text-[11px] leading-5 text-[var(--muted)]">
                    {t(group.descriptionKey)}
                  </div>
                  {group.titleKey === "feishuGroups.desktopIm.title" && !isFeishuImEnabled ? (
                    <div className="mt-2 text-[11px] text-amber-500">
                      {t("feishuGroups.desktopIm.disabledHint")}
                    </div>
                  ) : null}
                  {group.titleKey === "feishuGroups.desktopIm.title" && isFeishuImEnabled ? (
                    <div className="mt-2 text-[11px] text-[var(--muted)]">
                      {t("feishuGroups.desktopIm.preferenceHint", {
                        mode: resolveTransportLabel(),
                      })}
                    </div>
                  ) : null}
                </div>
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

      {(channelType === "feishu" || channelType === "telegram") && imRuntimeHint ? (
        <div className="rounded-xl border border-white/10 bg-[var(--foreground)]/[0.03] px-3 py-2 text-xs text-[var(--muted)]">
          <div className="font-medium text-[var(--foreground)]">
            {t("runtimeHint.currentDesktopIm", {
              mode: imRuntimeHint.enabled ? imRuntimeHint.effective : t("runtimeHint.disabled"),
            })}
          </div>
          <div className="mt-1">{imRuntimeHint.message}</div>
        </div>
      ) : null}

      {channelType === "wechat" ? (
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
      ) : null}

      <AnimatePresence>
        {testResult ? (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={cn(
              "flex items-center gap-2 rounded-xl px-3 py-2 text-xs",
              testResult.success
                ? "bg-emerald-500/10 text-emerald-400"
                : "bg-red-500/10 text-red-400"
            )}
          >
            {testResult.success ? (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <XCircle className="h-3.5 w-3.5 shrink-0" />
            )}
            {testResult.success ? t("test.success") : testResult.message || t("test.failed")}
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="flex items-center gap-2 pt-1">
        {showTest && channelType !== "wechat" ? (
          <GlassButton
            type="button"
            size="sm"
            variant="secondary"
            onClick={handleTest}
            disabled={testing || !isValid}
          >
            {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
            {t("actions.testSend")}
          </GlassButton>
        ) : null}
        <div className="flex-1" />
        <GlassButton type="button" size="sm" variant="ghost" onClick={onCancel}>
          {t("actions.cancel")}
        </GlassButton>
        <GlassButton
          type="button"
          size="sm"
          onClick={handleSave}
          disabled={saving || loadingConfig || !isValid}
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          {t("actions.save")}
        </GlassButton>
      </div>
    </div>
  )
}
