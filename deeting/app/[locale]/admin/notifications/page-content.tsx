"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import { Bell, Send } from "lucide-react"
import {
  AdminPageShell,
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

export function PageContent() {
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

  const columns: ColumnDef<NotificationAdminItem>[] = [
    {
      key: "title",
      header: "Title",
      sortable: true,
      render: (row) => <span className="font-medium text-[var(--foreground)]">{row.title}</span>,
    },
    {
      key: "type",
      header: "Type",
      render: (row) => <AdminStatusBadge text={row.type} tone={getStatusTone(row.type)} dot={false} />,
    },
    {
      key: "level",
      header: "Level",
      render: (row) => {
        const tone =
          row.level === "critical"
            ? "error"
            : row.level === "error"
              ? "error"
              : row.level === "warn"
                ? "warn"
                : "info"
        return <AdminStatusBadge text={row.level} tone={tone} />
      },
    },
    {
      key: "source",
      header: "Source",
      render: (row) => <span className="text-xs text-[var(--muted)]">{row.source || "—"}</span>,
    },
    {
      key: "created_at",
      header: "Sent",
      sortable: true,
      render: (row) => (
        <span className="text-xs text-[var(--muted)]">{new Date(row.created_at).toLocaleString()}</span>
      ),
    },
    {
      key: "content",
      header: "Content",
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

      setFeedback(`Sent: ${response.message}`)
      setContent("")
      setDedupeKey("")
      setExpiresAt("")
      await mutate()
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message : "Send failed"
      setFeedback(message)
    } finally {
      setIsSending(false)
    }
  }

  return (
    <AdminPageShell title="Notifications" description="Send system notifications and alerts" icon={Bell}>
      <GlassCard padding="default" hover="none">
        <h3 className="mb-4 text-sm font-semibold text-[var(--foreground)]">Compose Notification</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-xs font-medium text-[var(--muted)]">Title</label>
            <input
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Notification title"
              className="h-9 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] focus:border-[var(--primary)]/50 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <label className="text-xs font-medium text-[var(--muted)]">Type</label>
              <select
                value={type}
                onChange={(event) => setType(event.target.value as NotificationType)}
                className="h-9 w-full cursor-pointer rounded-lg border border-white/10 bg-white/5 px-2 text-sm text-[var(--foreground)] focus:outline-none"
              >
                <option value="system">system</option>
                <option value="alert">alert</option>
                <option value="billing">billing</option>
                <option value="audit">audit</option>
                <option value="security">security</option>
                <option value="maintenance">maintenance</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-[var(--muted)]">Level</label>
              <select
                value={level}
                onChange={(event) => setLevel(event.target.value as NotificationLevel)}
                className="h-9 w-full cursor-pointer rounded-lg border border-white/10 bg-white/5 px-2 text-sm text-[var(--foreground)] focus:outline-none"
              >
                <option value="info">info</option>
                <option value="warn">warn</option>
                <option value="error">error</option>
                <option value="critical">critical</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-[var(--muted)]">Target</label>
              <select
                value={target}
                onChange={(event) => setTarget(event.target.value as NotificationTarget)}
                className="h-9 w-full cursor-pointer rounded-lg border border-white/10 bg-white/5 px-2 text-sm text-[var(--foreground)] focus:outline-none"
              >
                <option value="broadcast">broadcast</option>
                <option value="user">specific user</option>
              </select>
            </div>
          </div>

          {target === "user" ? (
            <div className="space-y-2">
              <label className="text-xs font-medium text-[var(--muted)]">User ID</label>
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
              Broadcast to active users only
            </label>
          )}

          <div className="space-y-2">
            <label className="text-xs font-medium text-[var(--muted)]">Source</label>
            <input
              type="text"
              value={source}
              onChange={(event) => setSource(event.target.value)}
              placeholder="admin-dashboard"
              className="h-9 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] focus:border-[var(--primary)]/50 focus:outline-none"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-[var(--muted)]">Dedupe Key</label>
            <input
              type="text"
              value={dedupeKey}
              onChange={(event) => setDedupeKey(event.target.value)}
              placeholder="optional"
              className="h-9 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] focus:border-[var(--primary)]/50 focus:outline-none"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-[var(--muted)]">Expires At</label>
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
              className="h-9 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-[var(--foreground)] focus:border-[var(--primary)]/50 focus:outline-none"
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <label className="text-xs font-medium text-[var(--muted)]">Content</label>
            <textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="Notification content..."
              rows={3}
              className="w-full resize-none rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] focus:border-[var(--primary)]/50 focus:outline-none"
            />
          </div>

          <div className="md:col-span-2 flex items-center justify-between">
            <span className="text-xs text-[var(--muted)]" role="status">
              {feedback ?? "Compose and send notification"}
            </span>
            <button
              onClick={() => void handleSend()}
              disabled={!canSubmit || isSending}
              className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg bg-[var(--primary)] px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send className="size-3.5" />
              {isSending ? "Sending..." : "Send"}
            </button>
          </div>
        </div>
      </GlassCard>

      <AdminFilterBar
        searchPlaceholder="Search notifications..."
        onSearch={setSearchQuery}
        onFilterChange={(key, value) => {
          if (key === "type") setTypeFilter(value)
          if (key === "level") setLevelFilter(value)
        }}
        filters={[
          {
            key: "type",
            label: "Type",
            options: [
              { label: "System", value: "system" },
              { label: "Alert", value: "alert" },
              { label: "Billing", value: "billing" },
              { label: "Security", value: "security" },
            ],
          },
          {
            key: "level",
            label: "Level",
            options: [
              { label: "Info", value: "info" },
              { label: "Warn", value: "warn" },
              { label: "Error", value: "error" },
              { label: "Critical", value: "critical" },
            ],
          },
        ]}
      />

      <AdminDataTable
        columns={columns}
        data={rows}
        emptyMessage={
          isLoading
            ? "Loading notifications..."
            : error
              ? "Failed to load notifications"
              : "No notifications found"
        }
      />
    </AdminPageShell>
  )
}
