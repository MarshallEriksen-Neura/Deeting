"use client"

import { useState, useCallback, useEffect, useMemo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Bell,
  Plus,
  Send,
  Trash2,
  CheckCircle2,
  XCircle,
  Loader2,
  Mail,
  Globe,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Sparkles,
  MessageCircleMore,
} from "lucide-react"
import { GlassCard } from "@/components/ui/glass-card"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { useNotificationChannels } from "@/lib/swr/use-notification-channels"
import { useChatService } from "@/hooks/use-chat-service"
import type {
  ChannelType,
  ChannelConfig,
  NotificationChannel,
} from "@/lib/api/notification-channels"
import {
  CHANNEL_META,
  CHANNEL_REQUIRED_FIELDS,
  fetchNotificationChannel,
  createNotificationChannel,
  updateNotificationChannel,
  deleteNotificationChannel,
  testNotificationChannel,
} from "@/lib/api/notification-channels"
import { getDesktopImSettings, getPrimaryFeishuResolution } from "@/lib/api/desktop-im"
import {
  approveLocalWechatPairing,
  cancelLocalWechatPairing,
  disconnectLocalWechatChannel,
  getLocalWechatConnectionState,
  getLocalWechatPairingStatus,
  rejectLocalWechatPairing,
  startLocalWechatPairing,
} from "@/lib/api/wechat-connection"
import {
  WechatConnectDialog,
  type WechatConnectionViewState,
} from "./wechat-connect-dialog"
import { WechatPairingPanel } from "./wechat-pairing-panel"

const isDesktopRuntime = () =>
  process.env.NEXT_PUBLIC_IS_TAURI === "true" &&
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)

// =====================
// Channel icon mapping (lucide fallbacks for IM icons)
// =====================
const CHANNEL_ICONS: Record<ChannelType, typeof Mail> = {
  feishu: MessageSquare,
  wechat: MessageCircleMore,
  dingtalk: MessageSquare,
  telegram: Send,
  email: Mail,
  webhook: Globe,
}

const CHANNEL_COLORS: Record<ChannelType, string> = {
  feishu: "bg-blue-500/10 text-blue-400",
  wechat: "bg-emerald-500/10 text-emerald-400",
  dingtalk: "bg-sky-500/10 text-sky-400",
  telegram: "bg-cyan-500/10 text-cyan-400",
  email: "bg-amber-500/10 text-amber-400",
  webhook: "bg-purple-500/10 text-purple-400",
}

// =====================
// Main Client
// =====================
export function NotificationChannelsClient() {
  const { data, isLoading, mutate } = useNotificationChannels()
  const [showAdd, setShowAdd] = useState(false)
  const [addType, setAddType] = useState<ChannelType | null>(null)
  const isTauriRuntime =
    process.env.NEXT_PUBLIC_IS_TAURI === "true" &&
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)

  const channels = data?.items ?? []
  const selectableTypes = (Object.keys(CHANNEL_META) as ChannelType[]).filter(
    (type) => {
      if (!isTauriRuntime && type === "wechat") {
        return false
      }
      if (isTauriRuntime && type === "email") {
        return false
      }
      return true
    }
  )

  // Channels not yet added by the user
  const availableTypes = selectableTypes.filter(
    (type) => !channels.some((channel) => channel.channel === type)
  )

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="flex items-center gap-2.5 text-xl font-bold text-[var(--foreground)]">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--primary)]/10">
            <Bell className="h-5 w-5 text-[var(--primary)]" />
          </div>
          通知渠道
        </h1>
        <p className="mt-1.5 text-sm text-[var(--muted)]">
          配置你的通知渠道，寻猎任务发现质变时将按优先级依次推送
        </p>
      </div>

      {/* Existing channels */}
      <div className="space-y-3">
        <AnimatePresence mode="popLayout">
          {isLoading
            ? Array.from({ length: 2 }).map((_, i) => (
                <motion.div
                  key={`skel-${i}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <GlassCard padding="default">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 animate-pulse rounded-xl bg-[var(--foreground)]/10" />
                      <div className="flex-1 space-y-2">
                        <div className="h-4 w-32 animate-pulse rounded bg-[var(--foreground)]/10" />
                        <div className="h-3 w-48 animate-pulse rounded bg-[var(--foreground)]/5" />
                      </div>
                    </div>
                  </GlassCard>
                </motion.div>
              ))
            : channels.map((channel) => (
                <motion.div
                  key={channel.id}
                  layout
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.2 }}
                >
                  <ChannelCard channel={channel} onRefresh={mutate} />
                </motion.div>
              ))}
        </AnimatePresence>
      </div>

      {/* Add new channel */}
      {availableTypes.length > 0 && (
        <div className="mt-6">
          {!showAdd ? (
            <button
              onClick={() => setShowAdd(true)}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-white/10 py-4 text-sm text-[var(--muted)] transition-all hover:border-[var(--primary)]/30 hover:text-[var(--primary)] hover:bg-[var(--primary)]/[0.03]"
            >
              <Plus className="h-4 w-4" />
              添加通知渠道
            </button>
          ) : (
            <GlassCard padding="default" hover="none">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-medium text-[var(--foreground)]">
                  选择渠道类型
                </span>
                <button
                  onClick={() => {
                    setShowAdd(false)
                    setAddType(null)
                  }}
                  className="text-xs text-[var(--muted)] hover:text-[var(--foreground)]"
                >
                  取消
                </button>
              </div>

              {/* Type selector */}
              <div className="mb-4 grid grid-cols-5 gap-2">
                {availableTypes.map((type) => {
                  const Icon = CHANNEL_ICONS[type]
                  const meta = CHANNEL_META[type]
                  return (
                    <button
                      key={type}
                      onClick={() => setAddType(type)}
                      className={cn(
                        "flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-center transition-all",
                        addType === type
                          ? "border-[var(--primary)]/40 bg-[var(--primary)]/10"
                          : "border-white/5 bg-[var(--foreground)]/[0.02] hover:border-white/10 hover:bg-[var(--foreground)]/[0.05]"
                      )}
                    >
                      <Icon className={cn("h-5 w-5", CHANNEL_META[type].color)} />
                      <span className="text-[11px] font-medium text-[var(--foreground)]">
                        {meta.label}
                      </span>
                    </button>
                  )
                })}
              </div>

              {/* Config form for selected type */}
              <AnimatePresence mode="wait">
                {addType && (
                  <motion.div
                    key={addType}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <ChannelConfigForm
                      channelType={addType}
                      onSave={async (config, displayName) => {
                        await createNotificationChannel({
                          channel: addType,
                          config,
                          display_name: displayName || undefined,
                        })
                        mutate()
                        setShowAdd(false)
                        setAddType(null)
                      }}
                      onCancel={() => setAddType(null)}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </GlassCard>
          )}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && channels.length === 0 && !showAdd && (
        <div className="flex flex-col items-center py-16">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--primary)]/10">
            <Bell className="h-7 w-7 text-[var(--primary)] opacity-60" />
          </div>
          <p className="text-sm text-[var(--muted)]">
            尚未配置通知渠道，添加后寻猎任务可自动推送研判结果
          </p>
          <button
            onClick={() => setShowAdd(true)}
            className="mt-4 rounded-xl bg-[var(--primary)] px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-[var(--primary)]/20 transition-all hover:shadow-xl hover:shadow-[var(--primary)]/30 hover:-translate-y-0.5"
          >
            添加第一个渠道
          </button>
        </div>
      )}
    </div>
  )
}

// =====================
// Channel Card (existing channel)
// =====================
function ChannelCard({
  channel,
  onRefresh,
}: {
  channel: NotificationChannel
  onRefresh: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [toggling, setToggling] = useState(false)

  const Icon = CHANNEL_ICONS[channel.channel]
  const meta = CHANNEL_META[channel.channel]

  const handleToggle = useCallback(async () => {
    setToggling(true)
    try {
      await updateNotificationChannel(channel.id, {
        is_active: !channel.is_active,
      })
      onRefresh()
    } finally {
      setToggling(false)
    }
  }, [channel.id, channel.is_active, onRefresh])

  const handleDelete = useCallback(async () => {
    if (!confirm(`确认删除 ${meta.label} 渠道？`)) return
    setDeleting(true)
    try {
      await deleteNotificationChannel(channel.id)
      onRefresh()
    } finally {
      setDeleting(false)
    }
  }, [channel.id, meta.label, onRefresh])

  return (
    <GlassCard padding="default" hover="none">
      <div className="flex items-center gap-3">
        {/* Icon */}
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
            CHANNEL_COLORS[channel.channel]
          )}
        >
          <Icon className="h-5 w-5" />
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[var(--foreground)]">
              {channel.display_name || meta.label}
            </span>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                channel.is_active
                  ? "bg-emerald-500/10 text-emerald-400"
                  : "bg-zinc-500/10 text-zinc-400"
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  channel.is_active ? "bg-emerald-400" : "bg-zinc-400"
                )}
              />
              {channel.is_active ? "已启用" : "已停用"}
            </span>
          </div>
          <div className="mt-0.5 text-xs text-[var(--muted)]">
            {meta.description}
            {channel.last_used_at && (
              <span className="ml-2 opacity-60">
                · 上次使用{" "}
                {new Date(channel.last_used_at).toLocaleDateString("zh-CN")}
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          {/* Toggle */}
          <Switch
            checked={channel.is_active}
            onCheckedChange={handleToggle}
            disabled={toggling}
          />

          {/* Expand */}
          <button
            onClick={() => setExpanded(!expanded)}
            className="rounded-lg p-1.5 text-[var(--muted)] transition-colors hover:bg-[var(--foreground)]/5 hover:text-[var(--foreground)]"
          >
            {expanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>

          {/* Delete */}
          <button
            onClick={handleDelete}
            disabled={deleting}
            className={cn(
              "rounded-lg p-1.5 text-[var(--muted)] transition-colors hover:bg-red-500/10 hover:text-red-400",
              deleting && "opacity-50 pointer-events-none"
            )}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Expanded config form */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-4 border-t border-white/5 pt-4">
              <ChannelConfigForm
                channelType={channel.channel}
                channelId={channel.id}
                initialConfig={channel.config}
                initialDisplayName={channel.display_name ?? ""}
                onSave={async (config, displayName) => {
                  await updateNotificationChannel(channel.id, {
                    config,
                    display_name: displayName || undefined,
                  })
                  onRefresh()
                  setExpanded(false)
                }}
                onCancel={() => setExpanded(false)}
                showTest
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </GlassCard>
  )
}

// =====================
// Channel Config Form
// =====================

/** Per-channel form field definitions */
type FieldDef = {
  key: string
  label: string
  placeholder: string
  type?: "text" | "number" | "password" | "textarea" | "switch" | "select"
  valueKind?: "string" | "number" | "string[]" | "boolean"
  description?: string
  options?: Array<{ value: string; label: string }>
}

const FIELD_DEFS: Record<ChannelType, FieldDef[]> = {
  feishu: [
    {
      key: "webhook_url",
      label: "Webhook URL",
      placeholder: "https://open.feishu.cn/open-apis/bot/v2/hook/xxx",
    },
    {
      key: "chat_ids",
      label: "群 Chat IDs",
      placeholder: "oc_xxxxx\\noc_yyyyy",
      type: "textarea",
      valueKind: "string[]",
      description: "每行一个 chat_id，用于多群路由到当前用户",
    },
    {
      key: "bot_open_id",
      label: "机器人 Open ID",
      placeholder: "ou_xxx（可选，用于精确匹配@）",
    },
    {
      key: "bot_model",
      label: "回复模型",
      placeholder: "选择一个回复模型（可选）",
      type: "select",
      description: "留空时使用桌面端当前默认的秘书/聊天模型。",
    },
    {
      key: "bot_system_prompt",
      label: "系统提示词",
      placeholder: "可选：定义该渠道机器人的回复风格",
      type: "textarea",
    },
    {
      key: "bot_app_id",
      label: "飞书 App ID",
      placeholder: "cli_xxx（可选，渠道级覆盖）",
    },
    {
      key: "bot_app_secret",
      label: "飞书 App Secret",
      placeholder: "可选，渠道级覆盖",
      type: "password",
    },
    {
      key: "im_enabled",
      label: "启用桌面 IM",
      placeholder: "",
      type: "switch",
      valueKind: "boolean",
      description: "启用后，桌面端会根据下面的直连 / Relay 配置启动飞书机器人接入。",
    },
    {
      key: "transport_preference",
      label: "桌面传输偏好",
      placeholder: "选择传输模式",
      type: "select",
      options: [
        { value: "auto", label: "自动" },
        { value: "direct", label: "直连" },
        { value: "relay", label: "Relay" },
      ],
      description: "自动模式优先直连；强制直连或强制 Relay 时不会静默切换到另一条链路。",
    },
    {
      key: "relay_base_url",
      label: "Relay 服务地址",
      placeholder: "https://your-relay.example.com",
      description: "仅在自动回退或强制 Relay 时使用。",
    },
    {
      key: "relay_shared_secret",
      label: "Relay 共享密钥",
      placeholder: "可选，Relay 模式使用",
      type: "password",
      description: "与 deeting-relay 的 RELAY_SHARED_SECRET 保持一致。",
    },
  ],
  dingtalk: [
    {
      key: "webhook_url",
      label: "Webhook URL",
      placeholder: "https://oapi.dingtalk.com/robot/send?access_token=xxx",
    },
  ],
  wechat: [
    {
      key: "im_enabled",
      label: "启用桌面 IM",
      placeholder: "",
      type: "switch",
      valueKind: "boolean",
      description: "启用后，桌面端会接收来自已连接微信账号的消息。",
    },
    {
      key: "access_policy",
      label: "访问策略",
      placeholder: "选择访问策略",
      type: "select",
      options: [
        { value: "pairing", label: "配对码" },
        { value: "allowlist", label: "白名单" },
      ],
      description: "默认使用配对码模式；切换为白名单后，只允许已授权联系人进入本地 AI。",
    },
    {
      key: "bot_model",
      label: "回复模型",
      placeholder: "选择一个回复模型（可选）",
      type: "select",
      description: "留空时使用桌面端当前默认的秘书/聊天模型。",
    },
    {
      key: "bot_system_prompt",
      label: "系统提示词",
      placeholder: "可选：定义该微信渠道的回复风格",
      type: "textarea",
    },
  ],
  telegram: [
    {
      key: "bot_token",
      label: "Bot Token",
      placeholder: "123456:ABC-DEF...",
      type: "password",
    },
    { key: "chat_id", label: "Chat ID", placeholder: "-1001234567890" },
  ],
  email: [
    { key: "smtp_host", label: "SMTP 服务器", placeholder: "smtp.gmail.com" },
    { key: "smtp_port", label: "SMTP 端口", placeholder: "587", type: "number" },
    { key: "from_email", label: "发件人邮箱", placeholder: "you@example.com" },
    { key: "from_name", label: "发件人名称", placeholder: "Deeting OS" },
    { key: "to_email", label: "收件人邮箱", placeholder: "target@example.com" },
    {
      key: "username",
      label: "SMTP 用户名",
      placeholder: "（可选）",
    },
    {
      key: "password",
      label: "SMTP 密码",
      placeholder: "（可选）",
      type: "password",
    },
  ],
  webhook: [
    {
      key: "webhook_url",
      label: "Webhook URL",
      placeholder: "https://your-endpoint.com/hook",
    },
  ],
}

const FEISHU_FIELD_GROUPS = [
  {
    title: "基础通知",
    description: "用于主动推送通知；如果你只关心桌面机器人直连，可以先留空 Webhook。",
    keys: ["webhook_url", "chat_ids", "bot_open_id"],
  },
  {
    title: "桌面 IM",
    description: "决定桌面端是否直接接入飞书机器人，以及直连 / Relay 的选择方式。",
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
    title: "回复行为",
    description: "控制机器人收到消息后的模型和回复风格。",
    keys: ["bot_model", "bot_system_prompt"],
  },
] as const

type ChannelFormValue = string | boolean

function defaultFormValues(channelType: ChannelType): Record<string, ChannelFormValue> {
  if (channelType === "wechat") {
    return {
      im_enabled: true,
      access_policy: "pairing",
    }
  }
  return {}
}

function configToFormValues(
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

function ChannelConfigForm({
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
  const fields = FIELD_DEFS[channelType]
  const required = CHANNEL_REQUIRED_FIELDS[channelType]
  const { modelGroups, isLoadingModels } = useChatService({
    enabled: channelType === "feishu" || channelType === "wechat",
    modelCapability: "chat",
    fetchAssistants: false,
  })

  const [values, setValues] = useState<Record<string, ChannelFormValue>>(() =>
    ({
      ...defaultFormValues(channelType),
      ...configToFormValues(fields, initialConfig),
    })
  )
  const [displayName, setDisplayName] = useState(initialDisplayName ?? "")
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [loadingConfig, setLoadingConfig] = useState(false)
  const [testResult, setTestResult] = useState<{
    success: boolean
    message: string | null
  } | null>(null)
  const [imRuntimeHint, setImRuntimeHint] = useState<{
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
  })
  const [wechatConnectionState, setWechatConnectionState] = useState<WechatConnectionViewState>(
    () => {
      if (initialConfig?.connection_state === "connected") {
        return {
          state: "connected",
          accountLabel: initialConfig.account_label,
        }
      }
      if (initialConfig?.connection_state === "error") {
        return {
          state: "error",
          error: "微信连接状态异常，请重新连接。",
        }
      }
      return { state: "disconnected" }
    }
  )

  const setValue = (key: string, val: ChannelFormValue) =>
    setValues((prev) => ({ ...prev, [key]: val }))

  const botModelOptions = useMemo(() => {
    if (channelType !== "feishu" && channelType !== "wechat") return []
    return modelGroups.flatMap((group) =>
      group.models.map((model) => {
        const value = model.provider_model_id ?? model.id
        const provider = group.provider || model.owned_by || group.instance_name
        return {
          value,
          label: `${model.id}${provider ? ` · ${provider}` : ""}`,
        }
      })
    )
  }, [channelType, modelGroups])

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
  }, [channelId, fields, initialConfig])

  useEffect(() => {
    let active = true

    if (channelType !== "wechat") {
      setWechatConnectionState({ state: "disconnected" })
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
          error: "微信连接状态异常，请重新连接。",
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
            error: state.last_error || "微信连接状态异常，请重新连接。",
          })
        } else {
          setWechatConnectionState({ state: "disconnected" })
        }
        setWechatStats({
          pendingPairings: state.pending_pairings,
          allowlistSize: state.allowlist_size,
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
  }, [channelType, channelId, initialConfig])

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
              })
            } catch {
              // ignore
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
            error: "二维码已过期，请重新发起连接。",
          })
          setWechatPairingId(null)
        } else if (status.state === "cancelled") {
          setWechatConnectionState({ state: "disconnected" })
          setWechatPairingId(null)
        } else if (status.state === "error") {
          setWechatConnectionState({
            state: "error",
            error: status.error || "微信连接失败，请稍后重试。",
          })
          setWechatPairingId(null)
        }
      } catch (error) {
        if (!active) return
        setWechatConnectionState({
          state: "error",
          error: error instanceof Error ? error.message : "微信连接失败，请稍后重试。",
        })
        setWechatPairingId(null)
      }
    }, 2000)

    return () => {
      active = false
      window.clearInterval(intervalId)
    }
  }, [channelType, wechatPairingId, wechatDialogOpen])

  useEffect(() => {
    let active = true
    if (channelType !== "feishu" || !isDesktopRuntime()) {
      setImRuntimeHint(null)
      return () => {
        active = false
      }
    }

    const loadRuntimeHint = async () => {
      try {
        const snapshot = await getDesktopImSettings()
        const resolution = getPrimaryFeishuResolution(snapshot)
        if (!active) return
        if (resolution) {
          setImRuntimeHint({
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
  }, [channelType, initialConfig, channelId])

  const buildConfig = (): ChannelConfig => {
    const config: ChannelConfig = {}
    for (const f of fields) {
      const val = values[f.key]
      if (f.valueKind === "boolean") {
        ;(config as Record<string, unknown>)[f.key] = Boolean(val)
        continue
      }
      if (typeof val === "string" && val !== "") {
        if (f.valueKind === "string[]") {
          const items = val
            .split(/\r?\n|,/)
            .map((item) => item.trim())
            .filter(Boolean)
          if (items.length > 0) {
            ;(config as Record<string, unknown>)[f.key] = items
          }
        } else if (f.type === "number" || f.valueKind === "number") {
          const parsed = parseInt(val, 10)
          if (Number.isFinite(parsed)) {
            ;(config as Record<string, unknown>)[f.key] = parsed
          }
        } else {
          const text = val.trim()
          if (text) {
            ;(config as Record<string, unknown>)[f.key] = text
          }
        }
      }
    }
    if (channelType === "wechat") {
      config.access_policy =
        typeof values.access_policy === "string" && values.access_policy.trim().length > 0
          ? (values.access_policy as "pairing" | "allowlist")
          : "pairing"
      config.im_enabled = Boolean(values.im_enabled)
      config.connection_state = wechatConnectionState.state === "qr_ready"
        ? "connecting"
        : wechatConnectionState.state
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

    if (!hasWebhook && !imEnabled) {
      return false
    }
    if (!imEnabled) {
      return true
    }
    if (preference === "direct") {
      return hasDirectCreds
    }
    if (preference === "relay") {
      return hasRelayBaseUrl
    }
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
        error: error instanceof Error ? error.message : "微信连接失败，请稍后重试。",
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
          error: error instanceof Error ? error.message : "断开微信连接失败。",
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
          ? `已批准联系人 ${result.contact_id ?? ""}`.trim()
          : "批准配对失败"
      )
      setWechatPairingCode("")
      const state = await getLocalWechatConnectionState(channelId)
      setWechatStats({
        pendingPairings: state.pending_pairings,
        allowlistSize: state.allowlist_size,
      })
    } catch (error) {
      setWechatPairingFeedback(
        error instanceof Error ? error.message : "批准配对失败"
      )
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
      setWechatPairingFeedback("已拒绝该配对请求")
      setWechatPairingCode("")
      const state = await getLocalWechatConnectionState(channelId)
      setWechatStats({
        pendingPairings: state.pending_pairings,
        allowlistSize: state.allowlist_size,
      })
    } catch (error) {
      setWechatPairingFeedback(
        error instanceof Error ? error.message : "拒绝配对失败"
      )
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
    } catch (err: unknown) {
      setTestResult({
        success: false,
        message: err instanceof Error ? err.message : "测试失败",
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
    if (["bot_model", "bot_system_prompt"].includes(fieldKey)) {
      return !isFeishuImEnabled
    }
    return false
  }

  const renderField = (field: FieldDef) => {
    const muted = isFieldMuted(field.key)
    const disabled = loadingConfig || muted
    return (
      <div
        key={field.key}
        className={cn(
          "transition-all",
          muted && "opacity-45"
        )}
      >
        <FormField
          label={field.label}
          placeholder={field.placeholder}
          type={field.type}
          value={values[field.key] ?? (field.valueKind === "boolean" ? false : "")}
          onChange={(v) => setValue(field.key, v)}
          required={required.includes(field.key)}
          description={
            field.key === "bot_model" && isLoadingModels
              ? "正在加载可用聊天模型..."
              : field.description
          }
          options={field.key === "bot_model" ? botModelOptions : field.options}
          disabled={disabled}
        />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Display name */}
      <FormField
        label="显示名称"
        placeholder={`我的${CHANNEL_META[channelType].label}`}
        value={displayName}
        onChange={(nextValue) => setDisplayName(typeof nextValue === "string" ? nextValue : String(nextValue))}
      />

      {/* Channel-specific fields */}
      {channelType === "wechat" ? (
        <div className="space-y-4">
          <div className="rounded-2xl border border-white/8 bg-[var(--foreground)]/[0.02] p-4">
            <div className="mb-3 flex items-start gap-3">
              <div className="mt-0.5 rounded-xl bg-emerald-500/10 p-2 text-emerald-400">
                <MessageCircleMore className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-[var(--foreground)]">
                  微信扫码连接
                </div>
                <div className="mt-1 text-[11px] leading-5 text-[var(--muted)]">
                  扫码后即可让普通微信账号连接当前桌面实例，不需要填写 Relay 地址或回调配置。
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-white/5 px-2.5 py-1 text-[11px] text-[var(--muted)]">
                当前状态：
                {wechatConnectionState.state === "connected"
                  ? "已连接"
                  : wechatConnectionState.state === "connecting" ||
                      wechatConnectionState.state === "qr_ready"
                    ? "连接中"
                    : wechatConnectionState.state === "error"
                      ? "异常"
                      : "未连接"}
              </span>
              {wechatConnectionState.state === "connected" && wechatConnectionState.accountLabel ? (
                <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-300">
                  {wechatConnectionState.accountLabel}
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setWechatDialogOpen(true)
                  if (wechatConnectionState.state === "disconnected") {
                    void handleWechatConnect()
                  }
                }}
                className="rounded-xl border border-white/10 px-3.5 py-2 text-xs text-[var(--foreground)] transition-colors hover:bg-[var(--foreground)]/5"
              >
                {wechatConnectionState.state === "connected" ? "查看连接状态" : "连接微信"}
              </button>
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
              pairingCode={wechatPairingCode}
              onPairingCodeChange={setWechatPairingCode}
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
          {fields.map(renderField)}
        </div>
      ) : channelType === "feishu" ? (
        <div className="space-y-4">
          {FEISHU_FIELD_GROUPS.map((group) => (
            <div
              key={group.title}
              className="rounded-2xl border border-white/8 bg-[var(--foreground)]/[0.02] p-4"
            >
              <div className="mb-3 flex items-start gap-3">
                <div className="mt-0.5 rounded-xl bg-[var(--primary)]/10 p-2 text-[var(--primary)]">
                  <Sparkles className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[var(--foreground)]">
                    {group.title}
                  </div>
                  <div className="mt-1 text-[11px] leading-5 text-[var(--muted)]">
                    {group.description}
                  </div>
                  {group.title === "桌面 IM" && !isFeishuImEnabled ? (
                    <div className="mt-2 text-[11px] text-amber-500">
                      当前未启用桌面 IM，下面的直连与回复字段会暂时弱化显示。
                    </div>
                  ) : null}
                  {group.title === "桌面 IM" && isFeishuImEnabled ? (
                    <div className="mt-2 text-[11px] text-[var(--muted)]">
                      当前偏好：{transportPreference === "auto" ? "自动" : transportPreference === "direct" ? "直连" : "Relay"}
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

      {channelType === "feishu" && imRuntimeHint && (
        <div className="rounded-xl border border-white/10 bg-[var(--foreground)]/[0.03] px-3 py-2 text-xs text-[var(--muted)]">
          <div className="font-medium text-[var(--foreground)]">
            当前桌面 IM: {imRuntimeHint.effective}
          </div>
          <div className="mt-1">{imRuntimeHint.message}</div>
        </div>
      )}

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

      {/* Test result */}
      <AnimatePresence>
        {testResult && (
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
            {testResult.success
              ? "测试通知已发送成功"
              : testResult.message || "发送失败"}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        {showTest && channelType !== "wechat" && (
          <button
            onClick={handleTest}
            disabled={testing || !isValid}
            className={cn(
              "flex items-center gap-1.5 rounded-xl border border-white/10 px-3.5 py-2 text-xs font-medium text-[var(--foreground)] transition-all hover:bg-[var(--foreground)]/5",
              (testing || !isValid) && "opacity-40 pointer-events-none"
            )}
          >
            {testing ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Send className="h-3 w-3" />
            )}
            测试发送
          </button>
        )}
        <div className="flex-1" />
        <button
          onClick={onCancel}
          className="rounded-xl px-3.5 py-2 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--foreground)]/5 hover:text-[var(--foreground)]"
        >
          取消
        </button>
        <button
            onClick={handleSave}
            disabled={saving || loadingConfig || !isValid}
            className={cn(
              "flex items-center gap-1.5 rounded-xl bg-[var(--primary)] px-4 py-2 text-xs font-medium text-white shadow-lg shadow-[var(--primary)]/20 transition-all hover:shadow-xl hover:shadow-[var(--primary)]/30",
              (saving || loadingConfig || !isValid) && "opacity-50 pointer-events-none"
            )}
          >
          {saving && <Loader2 className="h-3 w-3 animate-spin" />}
          保存
        </button>
      </div>
    </div>
  )
}

// =====================
// Form Field
// =====================
function FormField({
  label,
  placeholder,
  value,
  onChange,
  type = "text",
  required,
  description,
  options,
  disabled = false,
}: {
  label: string
  placeholder: string
  value: string | boolean
  onChange: (v: string | boolean) => void
  type?: "text" | "number" | "password" | "textarea" | "switch" | "select"
  required?: boolean
  description?: string
  options?: Array<{ value: string; label: string }>
  disabled?: boolean
}) {
  return (
    <div>
      <label className="mb-1 flex items-center gap-1 text-[11px] font-medium text-[var(--muted)]">
        {label}
        {required && <span className="text-red-400">*</span>}
      </label>
      {type === "switch" ? (
        <div className="flex items-center justify-between rounded-xl border border-white/10 bg-[var(--foreground)]/[0.03] px-3 py-2">
          <span className="text-sm text-[var(--foreground)]">{placeholder || label}</span>
          <Switch
            checked={Boolean(value)}
            onCheckedChange={onChange}
            disabled={disabled}
          />
        </div>
      ) : type === "select" ? (
        <Select
          value={typeof value === "string" ? value : ""}
          onValueChange={(nextValue) => onChange(nextValue)}
          disabled={disabled}
        >
          <SelectTrigger className="w-full rounded-xl border border-white/10 bg-[var(--foreground)]/[0.03] px-3 py-2 text-sm text-[var(--foreground)]">
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {(options ?? []).map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : type === "textarea" ? (
        <textarea
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={4}
          disabled={disabled}
          className="w-full rounded-xl border border-white/10 bg-[var(--foreground)]/[0.03] px-3 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)]/40 outline-none transition-colors focus:border-[var(--primary)]/40 focus:ring-1 focus:ring-[var(--primary)]/20"
        />
      ) : (
        <input
          type={type}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full rounded-xl border border-white/10 bg-[var(--foreground)]/[0.03] px-3 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)]/40 outline-none transition-colors focus:border-[var(--primary)]/40 focus:ring-1 focus:ring-[var(--primary)]/20"
        />
      )}
      {description && <p className="mt-1 text-[11px] text-[var(--muted)]/80">{description}</p>}
    </div>
  )
}
