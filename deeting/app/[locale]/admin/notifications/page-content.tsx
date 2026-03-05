"use client"

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import useSWR from "swr"
import { Send } from "lucide-react"
import {
  AdminDataTable,
  AdminFilterBar,
  AdminStatusBadge,
  getStatusTone,
  type ColumnDef,
} from "@/components/admin"
import { GlassCard } from "@/components/ui/glass-card"
import {
  broadcastAdminNotification,
  fetchAdminNotifications,
  publishAdminNotificationToUser,
  type NotificationAdminItem,
} from "@/lib/api/admin-dashboard"

type NotificationTarget = "broadcast" | "user"
type NotificationType =
  | "system"
  | "alert"
  | "billing"
  | "audit"
  | "security"
  | "maintenance"
type NotificationLevel = "info" | "warn" | "error" | "critical"

function formatDateTime(value: string, locale: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date)
}

export function PageContent() {
  const t = useTranslations("admin.notificationsPage")
  const locale = useLocale()
  const [title, setTitle] = useState("")
  const [content, setContent] = useState("")
  const [type, setType] = useState<NotificationType>("system")
  const [level, setLevel] = useState<NotificationLevel>("info")
  const [target, setTarget] = useState<NotificationTarget>("broadcast")
  const [userId, setUserId] = useState("")
  const [source, setSource] = useState("admin-dashboard")
  const [dedupeKey, setDedupeKey] = useState("")
  const [expiresAt, setExpiresAt] = useState("")
  const [activeOnly, setActiveOnly] = useState(true)
  const [isSending, setIsSending] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [typeFilter, setTypeFilter] = useState("")
  const [levelFilter, setLevelFilter] = useState("")

  const {
    data,
    error,
    isLoading,
    mutate,
  } = useSWR(["/api/v1/admin/notifications", searchQuery, typeFilter, levelFilter], () =>
    fetchAdminNotifications({
      limit: 100,
      q: searchQuery.trim() || undefined,
      type: typeFilter || undefined,
      level: levelFilter || undefined,
    })
  )

  const rows = data?.items ?? []

  const typeTextMap: Record<string, string> = {
    system: t("type.system"),
    alert: t("type.alert"),
    billing: t("type.billing"),
    audit: t("type.audit"),
    security: t("type.security"),
    maintenance: t("type.maintenance"),
  }
  const levelTextMap: Record<string, string> = {
    info: t("level.info"),
    warn: t("level.warn"),
    error: t("level.error"),
    critical: t("level.critical"),
  }

  const columns: ColumnDef<NotificationAdminItem>[] = [
    {
      key: "title",
      header: t("table.headers.title"),
      sortable: true,
      render: (row) => <span className="font-medium text-[var(--foreground)]">{row.title}</span>,
    },
    {
      key: "type",
      header: t("table.headers.type"),
      render: (row) => (
        <AdminStatusBadge text={typeTextMap[row.type] ?? row.type} tone={getStatusTone(row.type)} dot={false} />
      ),
    },
    {
      key: "level",
      header: t("table.headers.level"),
      render: (row) => {
        const tone =
          row.level === "critical"
            ? "error"
            : row.level === "error"
              ? "error"
              : row.level === "warn"
                ? "warn"
                : "info"
        return <AdminStatusBadge text={levelTextMap[row.level] ?? row.level} tone={tone} />
      },
    },
    {
      key: "source",
      header: t("table.headers.source"),
      render: (row) => <span className="text-xs text-[var(--muted)]">{row.source || "—"}</span>,
    },
    {
      key: "created_at",
      header: t("table.headers.sent"),
      sortable: true,
      render: (row) => (
        <span className="text-xs text-[var(--muted)]">{formatDateTime(row.created_at, locale)}</span>
      ),
    },
    {
      key: "content",
      header: t("table.headers.content"),
      render: (row) => (
        <span className="inline-block max-w-[260px] truncate text-xs text-[var(--muted)]">{row.content}</span>
      ),
    },
  ]

  const canSubmit = useMemo(() => {
    if (!title.trim() || !content.trim()) return false
    if (target === "user" && !userId.trim()) return false
    return true
  }, [title, content, target, userId])

  const handleSend = async () => {
    if (!canSubmit || isSending) return

    const expiresAtIso = expiresAt ? new Date(expiresAt).toISOString() : undefined

    setIsSending(true)
    setFeedback(null)
    try {
      const payload = {
        title: title.trim(),
        content: content.trim(),
        type,
        level,
        source: source.trim() || undefined,
        dedupe_key: dedupeKey.trim() || undefined,
        expires_at: expiresAtIso,
      }

      const response =
        target === "user"
          ? await publishAdminNotificationToUser(userId.trim(), payload)
          : await broadcastAdminNotification({
              ...payload,
              active_only: activeOnly,
            })

      setFeedback(t("feedback.sent", { message: response.message }))
      setContent("")
      setDedupeKey("")
      setExpiresAt("")
      await mutate()
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message : t("feedback.sendFailed")
      setFeedback(message)
    } finally {
      setIsSending(false)
    }
  }

  return (
    <>
      <GlassCard padding="default" hover="none">
        <h3 className="mb-4 text-sm font-semibold text-[var(--foreground)]">{t("compose.title")}</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-xs font-medium text-[var(--muted)]">{t("compose.fields.title")}</label>
            <input
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t("compose.placeholders.title")}
              className="h-9 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] focus:border-[var(--primary)]/50 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <label className="text-xs font-medium text-[var(--muted)]">{t("compose.fields.type")}</label>
              <select
                value={type}
                onChange={(event) => setType(event.target.value as NotificationType)}
                className="h-9 w-full cursor-pointer rounded-lg border border-white/10 bg-white/5 px-2 text-sm text-[var(--foreground)] focus:outline-none"
              >
                <option value="system">{t("type.system")}</option>
                <option value="alert">{t("type.alert")}</option>
                <option value="billing">{t("type.billing")}</option>
                <option value="audit">{t("type.audit")}</option>
                <option value="security">{t("type.security")}</option>
                <option value="maintenance">{t("type.maintenance")}</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-[var(--muted)]">{t("compose.fields.level")}</label>
              <select
                value={level}
                onChange={(event) => setLevel(event.target.value as NotificationLevel)}
                className="h-9 w-full cursor-pointer rounded-lg border border-white/10 bg-white/5 px-2 text-sm text-[var(--foreground)] focus:outline-none"
              >
                <option value="info">{t("level.info")}</option>
                <option value="warn">{t("level.warn")}</option>
                <option value="error">{t("level.error")}</option>
                <option value="critical">{t("level.critical")}</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-[var(--muted)]">{t("compose.fields.target")}</label>
              <select
                value={target}
                onChange={(event) => setTarget(event.target.value as NotificationTarget)}
                className="h-9 w-full cursor-pointer rounded-lg border border-white/10 bg-white/5 px-2 text-sm text-[var(--foreground)] focus:outline-none"
              >
                <option value="broadcast">{t("target.broadcast")}</option>
                <option value="user">{t("target.user")}</option>
              </select>
            </div>
          </div>

          {target === "user" ? (
            <div className="space-y-2">
              <label className="text-xs font-medium text-[var(--muted)]">{t("compose.fields.userId")}</label>
              <input
                type="text"
                value={userId}
                onChange={(event) => setUserId(event.target.value)}
                placeholder="UUID"
                className="h-9 w-full rounded-lg border border-white/10 bg-white/5 px-3 font-mono text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] focus:border-[var(--primary)]/50 focus:outline-none"
              />
            </div>
          ) : (
            <label className="mt-6 inline-flex items-center gap-2 text-xs text-[var(--muted)]">
              <input
                type="checkbox"
                checked={activeOnly}
                onChange={(event) => setActiveOnly(event.target.checked)}
                className="accent-[var(--primary)]"
              />
              {t("compose.activeOnly")}
            </label>
          )}

          <div className="space-y-2">
            <label className="text-xs font-medium text-[var(--muted)]">{t("compose.fields.source")}</label>
            <input
              type="text"
              value={source}
              onChange={(event) => setSource(event.target.value)}
              placeholder="admin-dashboard"
              className="h-9 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] focus:border-[var(--primary)]/50 focus:outline-none"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-[var(--muted)]">{t("compose.fields.dedupeKey")}</label>
            <input
              type="text"
              value={dedupeKey}
              onChange={(event) => setDedupeKey(event.target.value)}
              placeholder={t("compose.placeholders.optional")}
              className="h-9 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] focus:border-[var(--primary)]/50 focus:outline-none"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-[var(--muted)]">{t("compose.fields.expiresAt")}</label>
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
              className="h-9 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-[var(--foreground)] focus:border-[var(--primary)]/50 focus:outline-none"
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <label className="text-xs font-medium text-[var(--muted)]">{t("compose.fields.content")}</label>
            <textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder={t("compose.placeholders.content")}
              rows={3}
              className="w-full resize-none rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] focus:border-[var(--primary)]/50 focus:outline-none"
            />
          </div>

          <div className="md:col-span-2 flex items-center justify-between">
            <span className="text-xs text-[var(--muted)]" role="status">
              {feedback ?? t("compose.hint")}
            </span>
            <button
              onClick={() => void handleSend()}
              disabled={!canSubmit || isSending}
              className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg bg-[var(--primary)] px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send className="size-3.5" />
              {isSending ? t("actions.sending") : t("actions.send")}
            </button>
          </div>
        </div>
      </GlassCard>

      <AdminFilterBar
        searchPlaceholder={t("filters.searchPlaceholder")}
        onSearch={setSearchQuery}
        onFilterChange={(key, value) => {
          if (key === "type") setTypeFilter(value)
          if (key === "level") setLevelFilter(value)
        }}
        filters={[
          {
            key: "type",
            label: t("filters.type"),
            options: [
              { label: t("type.system"), value: "system" },
              { label: t("type.alert"), value: "alert" },
              { label: t("type.billing"), value: "billing" },
              { label: t("type.security"), value: "security" },
            ],
          },
          {
            key: "level",
            label: t("filters.level"),
            options: [
              { label: t("level.info"), value: "info" },
              { label: t("level.warn"), value: "warn" },
              { label: t("level.error"), value: "error" },
              { label: t("level.critical"), value: "critical" },
            ],
          },
        ]}
      />

      <AdminDataTable
        columns={columns}
        data={rows}
        emptyMessage={
          isLoading
            ? t("empty.loading")
            : error
              ? t("empty.failed")
              : t("empty.noData")
        }
      />
    </>
  )
}
