"use client"

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import useSWR from "swr"

import {
  AdminDataTable,
  AdminFilterBar,
  AdminStatusBadge,
  getStatusTone,
  DonutChart,
  type ColumnDef,
} from "@/components/admin"
import { GlassCard } from "@/components/ui/glass-card"
import {
  createAdminRegistrationWindow,
  fetchAdminActiveRegistrationWindow,
  fetchAdminRegistrationInvites,
  issueAdminRegistrationInvites,
  type RegistrationInviteItem,
} from "@/lib/api/admin-dashboard"

function formatDate(value: string | null | undefined, locale: string) {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return new Intl.DateTimeFormat(locale).format(date)
}

export function PageContent() {
  const t = useTranslations("admin.registrationPage")
  const locale = useLocale()
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [startAt, setStartAt] = useState("")
  const [endAt, setEndAt] = useState("")
  const [maxRegistrations, setMaxRegistrations] = useState(100)
  const [autoActivate, setAutoActivate] = useState(true)
  const [inviteCount, setInviteCount] = useState(10)
  const [inviteLength, setInviteLength] = useState(12)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  const {
    data: activeWindow,
    error: windowError,
    isLoading: windowLoading,
    mutate: mutateWindow,
  } = useSWR("/api/v1/admin/registration/windows/active", fetchAdminActiveRegistrationWindow)

  const {
    data: inviteData,
    error: inviteError,
    isLoading: inviteLoading,
    mutate: mutateInvites,
  } = useSWR(
    activeWindow ? ["/api/v1/admin/registration/invites", activeWindow.id, statusFilter] : null,
    () =>
      fetchAdminRegistrationInvites({
        window_id: activeWindow!.id,
        status: statusFilter || undefined,
        limit: 100,
      })
  )

  const filteredInvites = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    const rows = inviteData?.items ?? []
    if (!query) return rows
    return rows.filter((row) =>
      [row.code, row.used_by].some((value) => String(value ?? "").toLowerCase().includes(query))
    )
  }, [inviteData?.items, searchQuery])

  const handleCreateWindow = async () => {
    if (!startAt || !endAt || maxRegistrations <= 0 || isSubmitting) return
    setIsSubmitting(true)
    setFeedback(null)
    try {
      await createAdminRegistrationWindow({
        start_time: new Date(startAt).toISOString(),
        end_time: new Date(endAt).toISOString(),
        max_registrations: maxRegistrations,
        auto_activate: autoActivate,
      })
      setFeedback(t("feedback.windowCreated"))
      await mutateWindow()
      await mutateInvites()
    } catch (createError) {
      const message =
        createError instanceof Error ? createError.message : t("feedback.windowCreateFailed")
      setFeedback(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleGenerateInvites = async () => {
    if (!activeWindow || inviteCount <= 0 || isSubmitting) return
    setIsSubmitting(true)
    setFeedback(null)
    try {
      const codes = await issueAdminRegistrationInvites(activeWindow.id, {
        count: inviteCount,
        length: inviteLength,
      })
      setFeedback(t("feedback.generatedInvites", { count: codes.length }))
      await mutateInvites()
    } catch (issueError) {
      const message =
        issueError instanceof Error ? issueError.message : t("feedback.generateFailed")
      setFeedback(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const inviteStatusMap: Record<string, string> = {
    unused: t("status.unused"),
    reserved: t("status.reserved"),
    used: t("status.used"),
    revoked: t("status.revoked"),
  }

  const columns: ColumnDef<RegistrationInviteItem>[] = [
    {
      key: "code",
      header: t("table.headers.code"),
      render: (row) => (
        <span className="font-mono text-sm font-medium text-[var(--foreground)]">{row.code}</span>
      ),
    },
    {
      key: "status",
      header: t("table.headers.status"),
      render: (row) => (
        <AdminStatusBadge
          text={inviteStatusMap[row.status] ?? row.status}
          tone={getStatusTone(row.status)}
        />
      ),
    },
    {
      key: "expires_at",
      header: t("table.headers.expires"),
      sortable: true,
      render: (row) => (
        <span className="text-xs text-[var(--muted)]">
          {formatDate(row.expires_at, locale)}
        </span>
      ),
    },
    {
      key: "used_by",
      header: t("table.headers.usedBy"),
      render: (row) => <span className="font-mono text-xs text-[var(--muted)]">{row.used_by ?? "—"}</span>,
    },
    {
      key: "used_at",
      header: t("table.headers.usedAt"),
      render: (row) => (
        <span className="text-xs text-[var(--muted)]">
          {formatDate(row.used_at, locale)}
        </span>
      ),
    },
  ]

  const usagePercent = activeWindow
    ? Math.round((activeWindow.registered_count / Math.max(1, activeWindow.max_registrations)) * 100)
    : 0

  return (
    <>
      <GlassCard padding="default" hover="none">
        <div className="grid gap-3 md:grid-cols-5">
          <input
            type="datetime-local"
            value={startAt}
            onChange={(event) => setStartAt(event.target.value)}
            className="h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-[var(--foreground)] focus:border-[var(--primary)]/50 focus:outline-none"
          />
          <input
            type="datetime-local"
            value={endAt}
            onChange={(event) => setEndAt(event.target.value)}
            className="h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-[var(--foreground)] focus:border-[var(--primary)]/50 focus:outline-none"
          />
          <input
            type="number"
            min={1}
            value={maxRegistrations}
            onChange={(event) => setMaxRegistrations(Number(event.target.value) || 1)}
            className="h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-[var(--foreground)] focus:border-[var(--primary)]/50 focus:outline-none"
          />
          <label className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 text-xs text-[var(--muted)]">
            <input
              type="checkbox"
              checked={autoActivate}
              onChange={(event) => setAutoActivate(event.target.checked)}
              className="accent-[var(--primary)]"
            />
            {t("autoActivate")}
          </label>
          <button
            onClick={() => void handleCreateWindow()}
            disabled={!startAt || !endAt || isSubmitting}
            className="inline-flex h-9 cursor-pointer items-center justify-center rounded-lg bg-[var(--primary)] px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? t("actions.submitting") : t("actions.newWindow")}
          </button>
        </div>
      </GlassCard>

      {feedback && <p className="text-xs text-[var(--muted)]">{feedback}</p>}
      {windowLoading && <p className="text-sm text-[var(--muted)]">{t("loading.activeWindow")}</p>}
      {windowError && <p className="text-sm text-rose-300">{t("loading.failedWindow")}</p>}

      {activeWindow ? (
        <GlassCard padding="default" hover="none">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-sm font-semibold text-[var(--foreground)]">{t("activeWindow.title")}</h3>
              <p className="mt-1 text-xs text-[var(--muted)]">
                {formatDate(activeWindow.start_time, locale)} — {formatDate(activeWindow.end_time, locale)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <AdminStatusBadge text={activeWindow.status} tone={getStatusTone(activeWindow.status)} />
              <AdminStatusBadge
                text={activeWindow.auto_activate ? t("activeWindow.autoActivate") : t("activeWindow.manual")}
                tone="info"
                dot={false}
              />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-6">
            <DonutChart
              value={activeWindow.registered_count}
              total={Math.max(1, activeWindow.max_registrations)}
              size={72}
              color="var(--primary)"
              label={`${usagePercent}%`}
            />
            <div>
              <p className="text-2xl font-bold text-[var(--foreground)]">
                {activeWindow.registered_count}
                <span className="text-sm font-normal text-[var(--muted)]"> / {activeWindow.max_registrations}</span>
              </p>
              <p className="text-xs text-[var(--muted)]">{t("activeWindow.registrationsUsed")}</p>
            </div>
          </div>
        </GlassCard>
      ) : (
        !windowLoading && (
          <GlassCard padding="default" hover="none">
            <p className="text-sm text-[var(--muted)]">{t("activeWindow.none")}</p>
          </GlassCard>
        )
      )}

      <GlassCard padding="default" hover="none">
        <div className="grid gap-3 md:grid-cols-4">
          <h3 className="col-span-1 self-center text-sm font-semibold text-[var(--foreground)]">
            {t("inviteCodes.title")}
          </h3>
          <input
            type="number"
            min={1}
            max={1000}
            value={inviteCount}
            onChange={(event) => setInviteCount(Number(event.target.value) || 1)}
            className="h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-[var(--foreground)] focus:border-[var(--primary)]/50 focus:outline-none"
          />
          <input
            type="number"
            min={6}
            max={32}
            value={inviteLength}
            onChange={(event) => setInviteLength(Number(event.target.value) || 12)}
            className="h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-[var(--foreground)] focus:border-[var(--primary)]/50 focus:outline-none"
          />
          <button
            onClick={() => void handleGenerateInvites()}
            disabled={!activeWindow || isSubmitting}
            className="inline-flex h-9 cursor-pointer items-center justify-center rounded-lg bg-[var(--primary)]/10 px-3 text-xs text-[var(--primary)] transition-colors hover:bg-[var(--primary)]/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("inviteCodes.generate")}
          </button>
        </div>
      </GlassCard>

      <AdminFilterBar
        searchPlaceholder={t("filters.searchPlaceholder")}
        onSearch={setSearchQuery}
        onFilterChange={(key, value) => {
          if (key === "status") setStatusFilter(value)
        }}
        filters={[
          {
            key: "status",
            label: t("filters.status"),
            options: [
              { label: t("status.unused"), value: "unused" },
              { label: t("status.reserved"), value: "reserved" },
              { label: t("status.used"), value: "used" },
              { label: t("status.revoked"), value: "revoked" },
            ],
          },
        ]}
      />

      <AdminDataTable
        columns={columns}
        data={filteredInvites}
        emptyMessage={
          !activeWindow
            ? t("empty.noActiveWindow")
            : inviteLoading
              ? t("empty.loading")
              : inviteError
                ? t("empty.failed")
                : t("empty.noData")
        }
      />
    </>
  )
}
