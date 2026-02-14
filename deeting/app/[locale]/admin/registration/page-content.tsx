"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import { Ticket } from "lucide-react"
import {
  AdminPageShell,
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

export function PageContent() {
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
      setFeedback("Created registration window")
      await mutateWindow()
      await mutateInvites()
    } catch (createError) {
      const message = createError instanceof Error ? createError.message : "Create window failed"
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
      setFeedback(`Generated ${codes.length} invite codes`)
      await mutateInvites()
    } catch (issueError) {
      const message = issueError instanceof Error ? issueError.message : "Generate invites failed"
      setFeedback(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const columns: ColumnDef<RegistrationInviteItem>[] = [
    {
      key: "code",
      header: "Code",
      render: (row) => (
        <span className="font-mono text-sm font-medium text-[var(--foreground)]">{row.code}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <AdminStatusBadge text={row.status} tone={getStatusTone(row.status)} />,
    },
    {
      key: "expires_at",
      header: "Expires",
      sortable: true,
      render: (row) => (
        <span className="text-xs text-[var(--muted)]">
          {row.expires_at ? new Date(row.expires_at).toLocaleDateString() : "—"}
        </span>
      ),
    },
    {
      key: "used_by",
      header: "Used By",
      render: (row) => <span className="font-mono text-xs text-[var(--muted)]">{row.used_by ?? "—"}</span>,
    },
    {
      key: "used_at",
      header: "Used At",
      render: (row) => (
        <span className="text-xs text-[var(--muted)]">
          {row.used_at ? new Date(row.used_at).toLocaleDateString() : "—"}
        </span>
      ),
    },
  ]

  const usagePercent = activeWindow
    ? Math.round((activeWindow.registered_count / Math.max(1, activeWindow.max_registrations)) * 100)
    : 0

  return (
    <AdminPageShell
      title="Registration Control"
      description="Manage registration windows and invite codes"
      icon={Ticket}
    >
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
            Auto activate
          </label>
          <button
            onClick={() => void handleCreateWindow()}
            disabled={!startAt || !endAt || isSubmitting}
            className="inline-flex h-9 cursor-pointer items-center justify-center rounded-lg bg-[var(--primary)] px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? "Submitting..." : "New Window"}
          </button>
        </div>
      </GlassCard>

      {feedback && <p className="text-xs text-[var(--muted)]">{feedback}</p>}
      {windowLoading && <p className="text-sm text-[var(--muted)]">Loading active window...</p>}
      {windowError && <p className="text-sm text-rose-300">Failed to load registration window</p>}

      {activeWindow ? (
        <GlassCard padding="default" hover="none">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-sm font-semibold text-[var(--foreground)]">Active Registration Window</h3>
              <p className="mt-1 text-xs text-[var(--muted)]">
                {new Date(activeWindow.start_time).toLocaleDateString()} — {new Date(activeWindow.end_time).toLocaleDateString()}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <AdminStatusBadge text={activeWindow.status} tone={getStatusTone(activeWindow.status)} />
              <AdminStatusBadge text={activeWindow.auto_activate ? "auto activate" : "manual"} tone="info" dot={false} />
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
              <p className="text-xs text-[var(--muted)]">Registrations used</p>
            </div>
          </div>
        </GlassCard>
      ) : (
        !windowLoading && (
          <GlassCard padding="default" hover="none">
            <p className="text-sm text-[var(--muted)]">No active registration window</p>
          </GlassCard>
        )
      )}

      <GlassCard padding="default" hover="none">
        <div className="grid gap-3 md:grid-cols-4">
          <h3 className="col-span-1 self-center text-sm font-semibold text-[var(--foreground)]">
            Invite Codes
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
            Generate Codes
          </button>
        </div>
      </GlassCard>

      <AdminFilterBar
        searchPlaceholder="Search invite codes..."
        onSearch={setSearchQuery}
        onFilterChange={(key, value) => {
          if (key === "status") setStatusFilter(value)
        }}
        filters={[
          {
            key: "status",
            label: "Status",
            options: [
              { label: "Unused", value: "unused" },
              { label: "Reserved", value: "reserved" },
              { label: "Used", value: "used" },
              { label: "Revoked", value: "revoked" },
            ],
          },
        ]}
      />

      <AdminDataTable
        columns={columns}
        data={filteredInvites}
        emptyMessage={
          !activeWindow
            ? "No active window"
            : inviteLoading
              ? "Loading invite codes..."
              : inviteError
                ? "Failed to load invite codes"
                : "No invite codes"
        }
      />
    </AdminPageShell>
  )
}
