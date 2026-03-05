"use client"

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import useSWR from "swr"

import {
  AdminStatCards,
  AdminDataTable,
  AdminFilterBar,
  AdminStatusBadge,
  getStatusTone,
  type ColumnDef,
  type StatCardData,
} from "@/components/admin"
import {
  archiveAdminConversation,
  closeAdminConversation,
  fetchAdminConversation,
  fetchAdminConversations,
  fetchAdminConversationMessages,
  fetchLocalConversationSummaryJobs,
  fetchLocalConversationSummaryQueueStats,
  retryLocalConversationSummaryJob,
  retryLocalConversationSummaryJobs,
  triggerLocalConversationSummary,
  type ConversationItem,
  type ConversationMessageItem,
} from "@/lib/api/admin-dashboard"
import { useUserProfile } from "@/hooks/use-user"

const LOCAL_DESKTOP_USER_ID = "00000000-0000-0000-0000-000000000000"

function shortId(value?: string | null) {
  if (!value) return "-"
  return `${value.slice(0, 8)}...`
}

function isTauriRuntime() {
  return (
    process.env.NEXT_PUBLIC_IS_TAURI === "true" &&
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  )
}

function toIsoDateTime(value: string): string | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) return undefined
  return parsed.toISOString()
}

export function PageContent() {
  const t = useTranslations("admin.conversationsPage")
  const locale = useLocale()
  const numberFormatter = new Intl.NumberFormat(locale)
  const dateTimeFormatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  })
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [channelFilter, setChannelFilter] = useState("")
  const [assistantIdFilter, setAssistantIdFilter] = useState("")
  const [startTimeFilter, setStartTimeFilter] = useState("")
  const [endTimeFilter, setEndTimeFilter] = useState("")
  const [onlyCurrentUser, setOnlyCurrentUser] = useState(true)
  const [failedReasonFilter, setFailedReasonFilter] = useState("")
  const [selectedSessionIdState, setSelectedSessionIdState] = useState("")
  const [includeDeletedMessages, setIncludeDeletedMessages] = useState(true)
  const [actionHint, setActionHint] = useState("")
  const tauriRuntime = isTauriRuntime()
  const { profile } = useUserProfile()
  const currentUserId = tauriRuntime ? LOCAL_DESKTOP_USER_ID : (profile?.id ?? null)
  const effectiveUserId = onlyCurrentUser ? (currentUserId ?? undefined) : undefined
  const canQueryConversations = !onlyCurrentUser || Boolean(effectiveUserId)
  const normalizedAssistantId = assistantIdFilter.trim() || undefined
  const normalizedStartTime = toIsoDateTime(startTimeFilter)
  const normalizedEndTime = toIsoDateTime(endTimeFilter)

  const { data, error, isLoading, mutate: mutateConversations } = useSWR(
    canQueryConversations
      ? [
          "/api/v1/admin/conversations",
          effectiveUserId ?? "all",
          statusFilter || "all",
          channelFilter || "all",
          normalizedAssistantId ?? "all",
          normalizedStartTime ?? "all",
          normalizedEndTime ?? "all",
        ]
      : null,
    () =>
      fetchAdminConversations({
        limit: 100,
        user_id: effectiveUserId,
        status: statusFilter || undefined,
        channel: channelFilter || undefined,
        assistant_id: normalizedAssistantId,
        start_time: normalizedStartTime,
        end_time: normalizedEndTime,
      })
  )

  const { data: queueStats, mutate: mutateQueueStats } = useSWR(
    tauriRuntime ? "/local/admin/conversation-summary/queue-stats" : null,
    () => fetchLocalConversationSummaryQueueStats()
  )

  const { data: failedJobsData, mutate: mutateFailedJobs } = useSWR(
    tauriRuntime
      ? ["/local/admin/conversation-summary/jobs?status=failed", failedReasonFilter]
      : null,
    () =>
      fetchLocalConversationSummaryJobs({
        limit: 200,
        status: "failed",
        error_contains: failedReasonFilter.trim() || undefined,
      })
  )

  const allRows = useMemo(() => data?.items ?? [], [data?.items])
  const selectedSessionId = useMemo(() => {
    if (allRows.length === 0) return ""
    if (selectedSessionIdState && allRows.some((item) => item.id === selectedSessionIdState)) {
      return selectedSessionIdState
    }
    return allRows[0]?.id ?? ""
  }, [allRows, selectedSessionIdState])

  const {
    data: conversationDetail,
    error: conversationDetailError,
    isLoading: isConversationDetailLoading,
  } = useSWR(
    selectedSessionId ? ["/api/v1/admin/conversations/detail", selectedSessionId] : null,
    () => fetchAdminConversation(selectedSessionId)
  )

  const {
    data: messageData,
    error: messageError,
    isLoading: isMessageLoading,
  } = useSWR(
    selectedSessionId
      ? ["/api/v1/admin/conversations/messages", selectedSessionId, includeDeletedMessages]
      : null,
    () =>
      fetchAdminConversationMessages(selectedSessionId, {
        limit: 200,
        include_deleted: includeDeletedMessages,
      })
  )

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return allRows.filter((row) => {
      if (statusFilter && row.status !== statusFilter) return false
      if (channelFilter && row.channel !== channelFilter) return false
      if (!query) return true
      return [row.title, row.id, row.user_id, row.assistant_id].some((value) =>
        String(value ?? "").toLowerCase().includes(query)
      )
    })
  }, [allRows, searchQuery, statusFilter, channelFilter])

  const total = allRows.length
  const active = allRows.filter((item) => item.status === "active").length
  const closed = allRows.filter((item) => item.status === "closed").length
  const archived = allRows.filter((item) => item.status === "archived").length
  const queuedJobs = (queueStats?.pending_jobs ?? 0) + (queueStats?.running_jobs ?? 0)
  const completedJobs = queueStats?.completed_jobs ?? 0
  const failedJobs = queueStats?.failed_jobs ?? failedJobsData?.total ?? 0

  const statusLabelMap: Record<string, string> = {
    active: t("status.active"),
    closed: t("status.closed"),
    archived: t("status.archived"),
  }

  const channelLabelMap: Record<string, string> = {
    internal: t("channel.internal"),
    external: t("channel.external"),
  }

  const stats: StatCardData[] = [
    { label: t("stats.total"), value: numberFormatter.format(total), color: "primary" },
    { label: t("stats.active"), value: numberFormatter.format(active), color: "emerald" },
    { label: t("stats.closed"), value: numberFormatter.format(closed), color: "amber" },
    tauriRuntime
      ? { label: "Queued Summaries", value: numberFormatter.format(queuedJobs), color: "teal" }
      : { label: t("stats.archived"), value: numberFormatter.format(archived), color: "default" },
    ...(tauriRuntime
      ? [
          {
            label: "Completed Summary Jobs",
            value: numberFormatter.format(completedJobs),
            color: "emerald",
          } as StatCardData,
        ]
      : []),
    ...(tauriRuntime
      ? [
          {
            label: "Failed Summary Jobs",
            value: numberFormatter.format(failedJobs),
            color: failedJobs > 0 ? "rose" : "default",
          } as StatCardData,
        ]
      : []),
  ]

  const failedJobBySession = useMemo(() => {
    const map = new Map<string, string>()
    for (const item of failedJobsData?.items ?? []) {
      map.set(item.session_id, item.id)
    }
    return map
  }, [failedJobsData?.items])

  const refreshSummaryAdminState = async () => {
    await Promise.all([mutateConversations(), mutateQueueStats(), mutateFailedJobs()])
  }

  const handleTriggerSummary = async (sessionId: string) => {
    try {
      await triggerLocalConversationSummary(sessionId)
      setActionHint(`Summary job queued for session ${shortId(sessionId)}`)
      await refreshSummaryAdminState()
    } catch (actionError) {
      const message = actionError instanceof Error ? actionError.message : "queue summary job failed"
      setActionHint(message)
    }
  }

  const handleRetrySummary = async (jobId: string, sessionId: string) => {
    try {
      await retryLocalConversationSummaryJob(jobId)
      setActionHint(`Retry queued for session ${shortId(sessionId)}`)
      await refreshSummaryAdminState()
    } catch (actionError) {
      const message = actionError instanceof Error ? actionError.message : "retry summary job failed"
      setActionHint(message)
    }
  }

  const handleRetryFilteredSummaries = async () => {
    try {
      const result = await retryLocalConversationSummaryJobs({
        status: "failed",
        error_contains: failedReasonFilter.trim() || undefined,
        limit: 200,
      })
      setActionHint(
        `Batch retry queued ${numberFormatter.format(result.queued_count)}/${numberFormatter.format(
          result.matched_count
        )}`
      )
      await refreshSummaryAdminState()
    } catch (actionError) {
      const message = actionError instanceof Error ? actionError.message : "batch retry summary jobs failed"
      setActionHint(message)
    }
  }

  const handleArchiveConversation = async (sessionId: string) => {
    try {
      await archiveAdminConversation(sessionId)
      setActionHint(`Conversation archived: ${shortId(sessionId)}`)
      await mutateConversations()
    } catch (actionError) {
      const message = actionError instanceof Error ? actionError.message : "archive conversation failed"
      setActionHint(message)
    }
  }

  const handleCloseConversation = async (sessionId: string) => {
    try {
      await closeAdminConversation(sessionId)
      setActionHint(`Conversation closed: ${shortId(sessionId)}`)
      await mutateConversations()
    } catch (actionError) {
      const message = actionError instanceof Error ? actionError.message : "close conversation failed"
      setActionHint(message)
    }
  }

  const failedReasonQuickFilters = [
    { label: "Timeout", value: "timeout" },
    { label: "Network", value: "connection" },
    { label: "Model Unavailable", value: "model" },
  ]
  const scopeActions = (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => setOnlyCurrentUser(true)}
        className={`rounded border px-2 py-1 text-xs transition-colors ${
          onlyCurrentUser
            ? "border-[var(--primary)]/40 text-[var(--foreground)]"
            : "border-white/10 text-[var(--muted)] hover:border-white/30 hover:text-[var(--foreground)]"
        }`}
      >
        Current User
      </button>
      <button
        type="button"
        onClick={() => setOnlyCurrentUser(false)}
        className={`rounded border px-2 py-1 text-xs transition-colors ${
          !onlyCurrentUser
            ? "border-[var(--primary)]/40 text-[var(--foreground)]"
            : "border-white/10 text-[var(--muted)] hover:border-white/30 hover:text-[var(--foreground)]"
        }`}
      >
        All Users
      </button>
    </div>
  )

  const selectedConversation = useMemo(
    () => conversationDetail ?? allRows.find((item) => item.id === selectedSessionId) ?? null,
    [allRows, conversationDetail, selectedSessionId]
  )

  const columns: ColumnDef<ConversationItem>[] = [
    {
      key: "title",
      header: t("table.headers.title"),
      sortable: true,
      render: (row) => (
        <span className="inline-block max-w-[220px] truncate font-medium text-[var(--foreground)]">
          {row.title || row.id}
        </span>
      ),
    },
    {
      key: "user_id",
      header: t("table.headers.user"),
      sortable: true,
      render: (row) => <span className="font-mono text-xs">{shortId(row.user_id)}</span>,
    },
    {
      key: "assistant_id",
      header: t("table.headers.assistant"),
      render: (row) => <span className="font-mono text-xs text-[var(--muted)]">{shortId(row.assistant_id)}</span>,
    },
    {
      key: "channel",
      header: t("table.headers.channel"),
      render: (row) => (
        <AdminStatusBadge
          text={channelLabelMap[row.channel] ?? row.channel}
          tone={getStatusTone(row.channel)}
          dot={false}
        />
      ),
    },
    {
      key: "status",
      header: t("table.headers.status"),
      render: (row) => (
        <AdminStatusBadge
          text={statusLabelMap[row.status] ?? row.status}
          tone={getStatusTone(row.status)}
        />
      ),
    },
    {
      key: "message_count",
      header: t("table.headers.messages"),
      sortable: true,
      align: "right",
      render: (row) => <span className="font-mono text-xs">{numberFormatter.format(row.message_count)}</span>,
    },
    {
      key: "last_active_at",
      header: t("table.headers.lastActive"),
      sortable: true,
      render: (row) => (
        <span className="text-xs text-[var(--muted)]">
          {row.last_active_at ? dateTimeFormatter.format(new Date(row.last_active_at)) : "-"}
        </span>
      ),
    },
    {
      key: "last_summary_version",
      header: t("table.headers.summary"),
      render: (row) => <span className="text-xs text-[var(--muted)]">v{row.last_summary_version}</span>,
    },
  ]

  const messageColumns: ColumnDef<ConversationMessageItem>[] = [
    {
      key: "turn_index",
      header: "Turn",
      sortable: true,
      align: "right",
      render: (row) => <span className="font-mono text-xs">{numberFormatter.format(row.turn_index)}</span>,
    },
    {
      key: "role",
      header: "Role",
      render: (row) => <span className="text-xs uppercase tracking-wide text-[var(--muted)]">{row.role}</span>,
    },
    {
      key: "is_deleted",
      header: "Deleted",
      align: "center",
      render: (row) =>
        row.is_deleted ? (
          <span className="rounded border border-rose-500/30 px-2 py-0.5 text-[10px] text-rose-300">Yes</span>
        ) : (
          <span className="text-[10px] text-[var(--muted)]">No</span>
        ),
    },
    {
      key: "content",
      header: "Content",
      render: (row) => (
        <span className="inline-block max-w-[540px] truncate text-xs text-[var(--foreground)]">
          {row.content || "-"}
        </span>
      ),
    },
    {
      key: "created_at",
      header: "Created At",
      sortable: true,
      render: (row) => (
        <span className="text-xs text-[var(--muted)]">
          {row.created_at ? dateTimeFormatter.format(new Date(row.created_at)) : "-"}
        </span>
      ),
    },
  ]

  return (
    <>
      <AdminStatCards stats={stats} columns={tauriRuntime ? 5 : 4} />
      <AdminFilterBar
        searchPlaceholder={t("filters.searchPlaceholder")}
        onSearch={setSearchQuery}
        onFilterChange={(key, value) => {
          if (key === "channel") setChannelFilter(value)
          if (key === "status") setStatusFilter(value)
        }}
        filters={[
          {
            key: "channel",
            label: t("filters.channel"),
            options: [
              { label: t("channel.internal"), value: "internal" },
              { label: t("channel.external"), value: "external" },
            ],
          },
          {
            key: "status",
            label: t("filters.status"),
            options: [
              { label: t("status.active"), value: "active" },
              { label: t("status.closed"), value: "closed" },
              { label: t("status.archived"), value: "archived" },
            ],
          },
        ]}
        actions={scopeActions}
      />
      <div className="mb-3 grid gap-2 md:grid-cols-3">
        <input
          value={assistantIdFilter}
          onChange={(event) => setAssistantIdFilter(event.target.value)}
          placeholder="Assistant ID"
          className="h-8 rounded border border-white/10 bg-white/5 px-2 text-xs text-[var(--foreground)] placeholder:text-[var(--muted)] focus:border-[var(--primary)]/40 focus:outline-none"
        />
        <input
          type="datetime-local"
          value={startTimeFilter}
          onChange={(event) => setStartTimeFilter(event.target.value)}
          className="h-8 rounded border border-white/10 bg-white/5 px-2 text-xs text-[var(--foreground)] focus:border-[var(--primary)]/40 focus:outline-none"
        />
        <input
          type="datetime-local"
          value={endTimeFilter}
          onChange={(event) => setEndTimeFilter(event.target.value)}
          className="h-8 rounded border border-white/10 bg-white/5 px-2 text-xs text-[var(--foreground)] focus:border-[var(--primary)]/40 focus:outline-none"
        />
      </div>
      {tauriRuntime && (
        <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-[var(--muted)]">
          <span>Pending: {numberFormatter.format(queueStats?.pending_jobs ?? 0)}</span>
          <span>Running: {numberFormatter.format(queueStats?.running_jobs ?? 0)}</span>
          <span>Completed: {numberFormatter.format(queueStats?.completed_jobs ?? 0)}</span>
          <span>Failed: {numberFormatter.format(queueStats?.failed_jobs ?? 0)}</span>
          <span>Idle due tasks: {numberFormatter.format(queueStats?.idle_due_tasks ?? 0)}</span>
          <span>Idle total tasks: {numberFormatter.format(queueStats?.idle_total_tasks ?? 0)}</span>
          <input
            type="text"
            value={failedReasonFilter}
            onChange={(event) => setFailedReasonFilter(event.target.value)}
            placeholder="Filter failed reason"
            className="h-8 min-w-[220px] rounded border border-white/10 bg-white/5 px-2 text-xs text-[var(--foreground)] placeholder:text-[var(--muted)] focus:border-[var(--primary)]/40 focus:outline-none"
          />
          {failedReasonQuickFilters.map((item) => (
            <button
              key={item.label}
              onClick={() => setFailedReasonFilter(item.value)}
              className="rounded border border-white/10 px-2 py-1 text-xs text-[var(--muted)] hover:border-white/30 hover:text-[var(--foreground)]"
            >
              {item.label}
            </button>
          ))}
          <button
            onClick={() => setFailedReasonFilter("")}
            className="rounded border border-white/10 px-2 py-1 text-xs text-[var(--muted)] hover:border-white/30 hover:text-[var(--foreground)]"
          >
            Clear Reason
          </button>
          <button
            onClick={() => void handleRetryFilteredSummaries()}
            className="rounded border border-rose-500/30 px-2 py-1 text-xs text-rose-300 hover:border-rose-400 hover:text-rose-200"
          >
            Retry Filtered Failed
          </button>
          {actionHint ? <span className="text-teal-300">{actionHint}</span> : null}
        </div>
      )}
      <AdminDataTable
        columns={columns}
        data={filteredRows}
        onRowClick={(row) => setSelectedSessionIdState(row.id)}
        rowActions={(row) => {
          const failedJobId = failedJobBySession.get(row.id)
          return (
            <div className="flex items-center justify-end gap-2">
              {row.status !== "archived" ? (
                <button
                  onClick={(event) => {
                    event.stopPropagation()
                    void handleArchiveConversation(row.id)
                  }}
                  className="rounded border border-amber-500/30 px-2 py-1 text-xs text-amber-200 hover:border-amber-400 hover:text-amber-100"
                >
                  Archive
                </button>
              ) : null}
              {row.status !== "closed" ? (
                <button
                  onClick={(event) => {
                    event.stopPropagation()
                    void handleCloseConversation(row.id)
                  }}
                  className="rounded border border-white/10 px-2 py-1 text-xs text-[var(--muted)] hover:border-white/30 hover:text-[var(--foreground)]"
                >
                  Close
                </button>
              ) : null}
              {tauriRuntime ? (
                <button
                  onClick={(event) => {
                    event.stopPropagation()
                    void handleTriggerSummary(row.id)
                  }}
                  className="rounded border border-white/10 px-2 py-1 text-xs text-[var(--muted)] hover:border-white/30 hover:text-[var(--foreground)]"
                >
                  Trigger
                </button>
              ) : null}
              {tauriRuntime && failedJobId ? (
                <button
                  onClick={(event) => {
                    event.stopPropagation()
                    void handleRetrySummary(failedJobId, row.id)
                  }}
                  className="rounded border border-rose-500/30 px-2 py-1 text-xs text-rose-300 hover:border-rose-400 hover:text-rose-200"
                >
                  Retry Failed
                </button>
              ) : null}
            </div>
          )
        }}
        emptyMessage={
          !canQueryConversations
            ? "Loading current user..."
            : isLoading
            ? t("empty.loading")
            : error
              ? t("empty.failed")
              : t("empty.noData")
        }
      />
      {selectedSessionId ? (
        <div className="mt-6 space-y-3">
          <div className="grid gap-2 rounded border border-white/10 bg-white/5 p-3 text-xs text-[var(--muted)] md:grid-cols-2">
            <div>
              Session ID: <span className="font-mono">{selectedSessionId}</span>
            </div>
            <div>
              Status: <span className="text-[var(--foreground)]">{selectedConversation?.status ?? "-"}</span>
            </div>
            <div>
              Channel: <span className="text-[var(--foreground)]">{selectedConversation?.channel ?? "-"}</span>
            </div>
            <div>
              Messages:{" "}
              <span className="text-[var(--foreground)]">
                {numberFormatter.format(selectedConversation?.message_count ?? 0)}
              </span>
            </div>
            <div>
              First Message:{" "}
              <span className="text-[var(--foreground)]">
                {selectedConversation?.first_message_at
                  ? dateTimeFormatter.format(new Date(selectedConversation.first_message_at))
                  : "-"}
              </span>
            </div>
            <div>
              Last Active:{" "}
              <span className="text-[var(--foreground)]">
                {selectedConversation?.last_active_at
                  ? dateTimeFormatter.format(new Date(selectedConversation.last_active_at))
                  : "-"}
              </span>
            </div>
            <div>
              Created:{" "}
              <span className="text-[var(--foreground)]">
                {selectedConversation?.created_at
                  ? dateTimeFormatter.format(new Date(selectedConversation.created_at))
                  : "-"}
              </span>
            </div>
            <div>
              Updated:{" "}
              <span className="text-[var(--foreground)]">
                {selectedConversation?.updated_at
                  ? dateTimeFormatter.format(new Date(selectedConversation.updated_at))
                  : "-"}
              </span>
            </div>
            {isConversationDetailLoading ? <div className="md:col-span-2">Loading conversation detail...</div> : null}
            {conversationDetailError ? (
              <div className="text-rose-300 md:col-span-2">Failed to load conversation detail</div>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-[var(--foreground)]">
              Message Details:{" "}
              <span className="font-mono text-xs text-[var(--muted)]">{shortId(selectedSessionId)}</span>
              {selectedConversation?.title ? (
                <span className="ml-2 text-xs text-[var(--muted)]">{selectedConversation.title}</span>
              ) : null}
            </div>
            <label className="inline-flex items-center gap-2 text-xs text-[var(--muted)]">
              <input
                type="checkbox"
                checked={includeDeletedMessages}
                onChange={(event) => setIncludeDeletedMessages(event.target.checked)}
                className="size-3.5 rounded border border-white/20 bg-transparent"
              />
              Include Deleted
            </label>
          </div>
          <AdminDataTable
            columns={messageColumns}
            data={messageData?.items ?? []}
            pageSize={20}
            emptyMessage={
              isMessageLoading
                ? "Loading conversation messages..."
                : messageError
                  ? "Failed to load conversation messages"
                  : "No conversation messages"
            }
          />
        </div>
      ) : null}
    </>
  )
}
