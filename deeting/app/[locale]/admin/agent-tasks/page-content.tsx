"use client"

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import useSWR from "swr"
import { Workflow, X } from "lucide-react"
import {
  AdminPageShell,
  AdminStatCards,
  AdminDataTable,
  AdminFilterBar,
  AdminStatusBadge,
  getStatusTone,
  type ColumnDef,
  type StatCardData,
} from "@/components/admin"
import {
  fetchAdminSpecLogSessions,
  fetchAdminSpecPlanLogs,
  fetchAdminSpecPlans,
  pauseAdminSpecPlan,
  resumeAdminSpecPlan,
  type SpecExecutionLogItem,
  type SpecPlanItem,
  type SpecWorkerSessionItem,
} from "@/lib/api/admin-dashboard"

function shortId(value?: string | null) {
  if (!value) return "—"
  return `${value.slice(0, 8)}...`
}

function formatDateTime(value: string | null | undefined, locale: string) {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date)
}

function prettyJson(value: unknown) {
  return JSON.stringify(value, null, 2)
}

function SpecPlanDetailDrawer({
  plan,
  locale,
  onClose,
}: {
  plan: SpecPlanItem | null
  locale: string
  onClose: () => void
}) {
  const t = useTranslations("admin.agentTasksPage")
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null)
  const [logStatusFilter, setLogStatusFilter] = useState("")
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null)

  useEffect(() => {
    setSelectedLogId(null)
    setLogStatusFilter("")
    setCopyFeedback(null)
  }, [plan?.id])

  const { data: logsData, isLoading: logsLoading, error: logsError } = useSWR(
    plan ? ["/api/v1/admin/spec-plans/logs", plan.id, logStatusFilter] : null,
    () =>
      fetchAdminSpecPlanLogs(plan!.id, {
        limit: 100,
        status: logStatusFilter.trim() || undefined,
      })
  )

  const logs = useMemo(() => logsData?.items ?? [], [logsData?.items])

  const { data: sessionsData, isLoading: sessionsLoading, error: sessionsError } = useSWR(
    selectedLogId ? ["/api/v1/admin/spec-logs/sessions", selectedLogId] : null,
    () => fetchAdminSpecLogSessions(selectedLogId!)
  )

  const selectedLog = useMemo(
    () => logs.find((item) => item.id === selectedLogId) ?? null,
    [logs, selectedLogId]
  )
  const sessions = useMemo(() => sessionsData?.items ?? [], [sessionsData?.items])

  const handleCopy = async (value: unknown) => {
    try {
      await navigator.clipboard.writeText(prettyJson(value))
      setCopyFeedback(t("drawer.copy.copied"))
    } catch {
      setCopyFeedback(t("drawer.copy.failed"))
    }
  }

  if (!plan) return null

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 flex h-full w-full max-w-3xl flex-col border-l border-white/10 bg-[var(--surface,#0a0a0f)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/5 px-6 py-4">
          <div>
            <h2 className="text-sm font-semibold text-[var(--foreground)]">{t("drawer.title")}</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">{plan.project_name}</p>
          </div>
          <button
            onClick={onClose}
            className="inline-flex size-8 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-white/5 hover:text-[var(--foreground)] transition-colors cursor-pointer"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="grid gap-4 border-b border-white/5 px-6 py-4 md:grid-cols-2">
          <div className="text-xs text-[var(--muted)]">
            {t("drawer.fields.planId")}: <span className="font-mono text-[var(--foreground)]">{plan.id}</span>
          </div>
          <div className="text-xs text-[var(--muted)]">
            {t("drawer.fields.user")}: <span className="font-mono text-[var(--foreground)]">{plan.user_id}</span>
          </div>
          <div className="text-xs text-[var(--muted)]">
            {t("drawer.fields.status")}: <span className="text-[var(--foreground)]">{plan.status}</span>
          </div>
          <div className="text-xs text-[var(--muted)]">
            {t("drawer.fields.version")}: <span className="text-[var(--foreground)]">v{plan.version}</span>
          </div>
          <div className="text-xs text-[var(--muted)]">
            {t("drawer.fields.created")}: <span className="text-[var(--foreground)]">{formatDateTime(plan.created_at, locale)}</span>
          </div>
          <div className="text-xs text-[var(--muted)]">
            {t("drawer.fields.updated")}: <span className="text-[var(--foreground)]">{formatDateTime(plan.updated_at, locale)}</span>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 p-6 lg:grid-cols-2">
          <div className="min-h-0 rounded-lg border border-white/10 bg-white/[0.02] p-3">
            <div className="mb-3 text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
              {t("drawer.logsTitle")}
            </div>
            <div className="mb-3 flex items-center gap-2">
              <input
                value={logStatusFilter}
                onChange={(event) => setLogStatusFilter(event.target.value)}
                placeholder={t("drawer.logStatusPlaceholder")}
                className="h-8 w-full rounded-lg border border-white/10 bg-white/5 px-2 text-xs text-[var(--foreground)] placeholder:text-[var(--muted)] focus:border-[var(--primary)]/40 focus:outline-none"
              />
              <button
                onClick={() => setLogStatusFilter("")}
                className="inline-flex h-8 shrink-0 cursor-pointer items-center rounded-lg border border-white/10 px-2 text-xs text-[var(--muted)] transition-colors hover:bg-white/10 hover:text-[var(--foreground)]"
              >
                {t("drawer.clearFilter")}
              </button>
            </div>
            <div className="max-h-full space-y-2 overflow-y-auto">
              {logsLoading && <p className="text-xs text-[var(--muted)]">{t("drawer.logsLoading")}</p>}
              {logsError && <p className="text-xs text-rose-400">{t("drawer.logsFailed")}</p>}
              {!logsLoading && !logsError && logs.length === 0 && (
                <p className="text-xs text-[var(--muted)]">{t("drawer.logsEmpty")}</p>
              )}
              {logs.map((log: SpecExecutionLogItem) => (
                <button
                  key={log.id}
                  onClick={() => setSelectedLogId(log.id)}
                  className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                    selectedLogId === log.id
                      ? "border-[var(--primary)]/40 bg-[var(--primary)]/10"
                      : "border-white/10 bg-white/[0.02] hover:bg-white/5"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-[var(--foreground)]">{log.node_id}</span>
                    <span className="text-[10px] text-[var(--muted)]">{log.status}</span>
                  </div>
                  <div className="mt-1 text-[10px] text-[var(--muted)]">
                    {formatDateTime(log.created_at, locale)}
                  </div>
                  {log.error_message && (
                    <div className="mt-1 line-clamp-2 text-[10px] text-rose-300">{log.error_message}</div>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 rounded-lg border border-white/10 bg-white/[0.02] p-3">
            <div className="mb-3 text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
              {t("drawer.sessionsTitle")}
            </div>
            {copyFeedback && <p className="mb-2 text-xs text-[var(--muted)]">{copyFeedback}</p>}
            {!selectedLog && <p className="text-xs text-[var(--muted)]">{t("drawer.selectLogHint")}</p>}
            {selectedLog && (
              <div className="space-y-3">
                <div className="rounded-lg border border-white/10 bg-white/[0.02] p-2">
                  <div className="text-[10px] text-[var(--muted)]">{t("drawer.selectedLog")}</div>
                  <div className="mt-1 font-mono text-xs text-[var(--foreground)]">{selectedLog.id}</div>
                </div>

                <details className="rounded-lg border border-white/10 bg-white/[0.02] p-2">
                  <summary className="cursor-pointer text-xs text-[var(--foreground)]">{t("drawer.json.inputSnapshot")}</summary>
                  {selectedLog.input_snapshot ? (
                    <div className="mt-2 space-y-2">
                      <button
                        onClick={() => void handleCopy(selectedLog.input_snapshot)}
                        className="inline-flex h-7 cursor-pointer items-center rounded-lg border border-white/10 px-2 text-[10px] text-[var(--muted)] transition-colors hover:bg-white/10 hover:text-[var(--foreground)]"
                      >
                        {t("drawer.copy.action")}
                      </button>
                      <pre className="max-h-48 overflow-auto rounded-lg border border-white/10 bg-black/20 p-2 text-[10px] text-[var(--muted)]">
                        {prettyJson(selectedLog.input_snapshot)}
                      </pre>
                    </div>
                  ) : (
                    <p className="mt-2 text-[10px] text-[var(--muted)]">{t("drawer.json.empty")}</p>
                  )}
                </details>

                <details className="rounded-lg border border-white/10 bg-white/[0.02] p-2">
                  <summary className="cursor-pointer text-xs text-[var(--foreground)]">{t("drawer.json.outputData")}</summary>
                  {selectedLog.output_data ? (
                    <div className="mt-2 space-y-2">
                      <button
                        onClick={() => void handleCopy(selectedLog.output_data)}
                        className="inline-flex h-7 cursor-pointer items-center rounded-lg border border-white/10 px-2 text-[10px] text-[var(--muted)] transition-colors hover:bg-white/10 hover:text-[var(--foreground)]"
                      >
                        {t("drawer.copy.action")}
                      </button>
                      <pre className="max-h-48 overflow-auto rounded-lg border border-white/10 bg-black/20 p-2 text-[10px] text-[var(--muted)]">
                        {prettyJson(selectedLog.output_data)}
                      </pre>
                    </div>
                  ) : (
                    <p className="mt-2 text-[10px] text-[var(--muted)]">{t("drawer.json.empty")}</p>
                  )}
                </details>

                <details className="rounded-lg border border-white/10 bg-white/[0.02] p-2">
                  <summary className="cursor-pointer text-xs text-[var(--foreground)]">{t("drawer.json.rawResponse")}</summary>
                  {selectedLog.raw_response != null ? (
                    <div className="mt-2 space-y-2">
                      <button
                        onClick={() => void handleCopy(selectedLog.raw_response)}
                        className="inline-flex h-7 cursor-pointer items-center rounded-lg border border-white/10 px-2 text-[10px] text-[var(--muted)] transition-colors hover:bg-white/10 hover:text-[var(--foreground)]"
                      >
                        {t("drawer.copy.action")}
                      </button>
                      <pre className="max-h-48 overflow-auto rounded-lg border border-white/10 bg-black/20 p-2 text-[10px] text-[var(--muted)]">
                        {prettyJson(selectedLog.raw_response)}
                      </pre>
                    </div>
                  ) : (
                    <p className="mt-2 text-[10px] text-[var(--muted)]">{t("drawer.json.empty")}</p>
                  )}
                </details>

                {sessionsLoading && <p className="text-xs text-[var(--muted)]">{t("drawer.sessionsLoading")}</p>}
                {sessionsError && <p className="text-xs text-rose-400">{t("drawer.sessionsFailed")}</p>}
                {!sessionsLoading && !sessionsError && sessions.length === 0 && (
                  <p className="text-xs text-[var(--muted)]">{t("drawer.sessionsEmpty")}</p>
                )}

                <div className="max-h-[420px] space-y-2 overflow-y-auto">
                  {sessions.map((session: SpecWorkerSessionItem) => (
                    <div key={session.id} className="rounded-lg border border-white/10 bg-white/[0.02] p-2">
                      <div className="font-mono text-[10px] text-[var(--foreground)]">{session.id}</div>
                      <div className="mt-1 grid grid-cols-3 gap-2 text-[10px] text-[var(--muted)]">
                        <span>{t("drawer.sessionMetrics.messages", { count: session.internal_messages.length })}</span>
                        <span>{t("drawer.sessionMetrics.thoughts", { count: session.thought_trace.length })}</span>
                        <span>{t("drawer.sessionMetrics.tokens", { count: session.total_tokens })}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

export function PageContent() {
  const tAdmin = useTranslations("admin")
  const t = useTranslations("admin.agentTasksPage")
  const locale = useLocale()
  const dateTimeFormatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  })
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
  })
  const numberFormatter = new Intl.NumberFormat(locale)
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [selectedPlan, setSelectedPlan] = useState<SpecPlanItem | null>(null)
  const [actioningId, setActioningId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)

  const { data, error, isLoading, mutate } = useSWR(
    ["/api/v1/admin/spec-plans", statusFilter],
    () =>
      fetchAdminSpecPlans({
        limit: 100,
        status: statusFilter || undefined,
      })
  )

  const allRows = useMemo(() => data?.items ?? [], [data?.items])

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return allRows
    return allRows.filter((row) => {
      return [row.project_name, row.id, row.user_id, row.conversation_session_id].some((value) =>
        String(value ?? "").toLowerCase().includes(query)
      )
    })
  }, [allRows, searchQuery])

  const total = allRows.length
  const running = allRows.filter((item) => item.status === "RUNNING").length
  const completed = allRows.filter((item) => item.status === "COMPLETED").length
  const failed = allRows.filter((item) => item.status === "FAILED").length

  const statusLabelMap: Record<string, string> = {
    DRAFT: t("status.draft"),
    RUNNING: t("status.running"),
    PAUSED: t("status.paused"),
    COMPLETED: t("status.completed"),
    FAILED: t("status.failed"),
  }

  const stats: StatCardData[] = [
    { label: t("stats.totalTasks"), value: numberFormatter.format(total), color: "primary" },
    { label: t("stats.running"), value: numberFormatter.format(running), color: "teal" },
    { label: t("stats.completed"), value: numberFormatter.format(completed), color: "emerald" },
    { label: t("stats.failed"), value: numberFormatter.format(failed), color: "rose" },
  ]

  const columns: ColumnDef<SpecPlanItem>[] = [
    {
      key: "project_name",
      header: t("table.headers.project"),
      sortable: true,
      render: (row) => <span className="font-medium text-[var(--foreground)]">{row.project_name}</span>,
    },
    {
      key: "user_id",
      header: t("table.headers.user"),
      sortable: true,
      render: (row) => <span className="font-mono text-xs">{shortId(row.user_id)}</span>,
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
      key: "version",
      header: t("table.headers.version"),
      render: (row) => <span className="text-xs text-[var(--muted)]">v{row.version}</span>,
    },
    {
      key: "priority",
      header: t("table.headers.priority"),
      sortable: true,
      render: (row) => <span className="font-mono text-xs">{row.priority}</span>,
    },
    {
      key: "conversation_session_id",
      header: t("table.headers.session"),
      render: (row) => <span className="font-mono text-xs text-[var(--muted)]">{shortId(row.conversation_session_id)}</span>,
    },
    {
      key: "updated_at",
      header: t("table.headers.updated"),
      sortable: true,
      render: (row) => <span className="text-xs text-[var(--muted)]">{dateTimeFormatter.format(new Date(row.updated_at))}</span>,
    },
    {
      key: "created_at",
      header: t("table.headers.created"),
      sortable: true,
      render: (row) => <span className="text-xs text-[var(--muted)]">{dateFormatter.format(new Date(row.created_at))}</span>,
    },
  ]

  const handleToggleStatus = async (row: SpecPlanItem) => {
    if (actioningId) return
    const isPause = row.status === "RUNNING"
    const isResume = row.status === "PAUSED"
    if (!isPause && !isResume) return

    setActioningId(row.id)
    setFeedback(null)
    try {
      if (isPause) {
        await pauseAdminSpecPlan(row.id)
        setFeedback(t("feedback.paused", { project: row.project_name }))
      } else {
        await resumeAdminSpecPlan(row.id)
        setFeedback(t("feedback.resumed", { project: row.project_name }))
      }
      await mutate()
    } catch (actionError) {
      const message =
        actionError instanceof Error ? actionError.message : t("feedback.operationFailed")
      setFeedback(message)
    } finally {
      setActioningId(null)
    }
  }

  return (
    <AdminPageShell title={tAdmin("agentTasks.title")} description={tAdmin("agentTasks.description")} icon={Workflow}>
      <AdminStatCards stats={stats} columns={4} />
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
              { label: t("status.draft"), value: "DRAFT" },
              { label: t("status.running"), value: "RUNNING" },
              { label: t("status.paused"), value: "PAUSED" },
              { label: t("status.completed"), value: "COMPLETED" },
              { label: t("status.failed"), value: "FAILED" },
            ],
          },
        ]}
      />
      {feedback && <p className="text-xs text-[var(--muted)]">{feedback}</p>}
      <AdminDataTable
        columns={columns}
        data={filteredRows}
        onRowClick={(row) => setSelectedPlan(row)}
        emptyMessage={
          isLoading
            ? t("empty.loading")
            : error
              ? t("empty.failed")
              : t("empty.noData")
        }
        rowActions={(row) => {
          const canPause = row.status === "RUNNING"
          const canResume = row.status === "PAUSED"
          if (!canPause && !canResume) {
            return <span className="text-xs text-[var(--muted)]">—</span>
          }

          return (
            <button
              onClick={(event) => {
                event.stopPropagation()
                void handleToggleStatus(row)
              }}
              disabled={Boolean(actioningId)}
              className="inline-flex h-7 cursor-pointer items-center rounded-lg border border-white/10 px-2 text-xs text-[var(--muted)] transition-colors hover:bg-white/10 hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {canPause ? t("actions.pause") : t("actions.resume")}
            </button>
          )
        }}
      />
      <SpecPlanDetailDrawer plan={selectedPlan} locale={locale} onClose={() => setSelectedPlan(null)} />
    </AdminPageShell>
  )
}
