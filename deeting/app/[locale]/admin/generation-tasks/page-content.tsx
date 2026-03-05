"use client"

import { useMemo, useState, useCallback } from "react"
import { useLocale, useTranslations } from "next-intl"
import useSWR from "swr"
import { ImageIcon, RefreshCw, Download, X, Clock, DollarSign, TrendingUp, Zap, ExternalLink } from "lucide-react"
import {
  AdminStatCards,
  AdminDataTable,
  AdminFilterBar,
  AdminStatusBadge,
  DonutChart,
  BarChartMini,
  getStatusTone,
  type ColumnDef,
  type StatCardData,
} from "@/components/admin"
import { GlassCard } from "@/components/ui/glass-card"
import {
  fetchAdminGenerationTask,
  fetchAdminGenerationTaskOutputs,
  fetchAdminGenerationShares,
  fetchAdminGenerationTasks,
  updateAdminGenerationShareActive,
  type GenerationOutputItem,
  type GenerationShareItem,
  type GenerationTaskItem,
} from "@/lib/api/admin-dashboard"

type CsvColumn = {
  key: keyof GenerationTaskItem
  label: string
}

type TranslateFn = (key: string, values?: Record<string, string | number>) => string

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

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

function durationInSeconds(start?: string | null, end?: string | null) {
  if (!start || !end) return null
  const startTime = new Date(start).getTime()
  const endTime = new Date(end).getTime()
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime < startTime) {
    return null
  }
  return Math.round((endTime - startTime) / 1000)
}

function formatDuration(seconds: number, t: TranslateFn) {
  if (seconds < 60) return t("duration.seconds", { value: seconds })
  const minutes = Math.floor(seconds / 60)
  const restSeconds = seconds % 60
  return t("duration.minuteSeconds", { minutes, seconds: restSeconds })
}

function downloadCSV(rows: GenerationTaskItem[], filename: string, columns: CsvColumn[]) {
  const csvRows = [
    columns.map((column) => column.label).join(","),
    ...rows.map((row) =>
      columns
        .map((column) => {
          const value = row[column.key]
          const str = String(value ?? "")
          return `"${str.replace(/"/g, '""')}"`
        })
        .join(",")
    ),
  ]
  const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function getTaskTypeKey(taskType: string) {
  if (taskType === "image_generation") return "image"
  if (taskType === "text_to_speech") return "audio"
  if (taskType === "video_generation") return "video"
  return "unknown"
}

function getTaskTypeTone(taskType: string) {
  if (taskType === "image_generation") return "primary" as const
  if (taskType === "text_to_speech") return "teal" as const
  return "info" as const
}

function getTaskStatusLabel(status: string, t: TranslateFn) {
  if (status === "queued") return t("status.queued")
  if (status === "running") return t("status.running")
  if (status === "succeeded") return t("status.succeeded")
  if (status === "failed") return t("status.failed")
  if (status === "canceled") return t("status.canceled")
  return status
}

const TYPE_COLORS: Record<string, string> = {
  image_generation: "rgb(var(--color-primary))",
  text_to_speech: "rgb(45,212,191)",
  video_generation: "rgb(96,165,250)",
}

const STATUS_CHART_COLORS: Record<string, string> = {
  succeeded: "rgb(52,211,153)",
  running: "rgb(96,165,250)",
  queued: "rgb(251,191,36)",
  failed: "rgb(251,113,133)",
  canceled: "rgb(148,163,184)",
}

/* ------------------------------------------------------------------ */
/*  Task Detail Drawer                                                 */
/* ------------------------------------------------------------------ */

function TaskDetailDrawer({
  task,
  outputs,
  outputsLoading,
  outputsError,
  onClose,
}: {
  task: GenerationTaskItem | null
  outputs: GenerationOutputItem[]
  outputsLoading: boolean
  outputsError: Error | null
  onClose: () => void
}) {
  const t = useTranslations("admin.generationTasksPage")
  const locale = useLocale()
  const currencyFormatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  })
  const dateTimeFormatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  })

  if (!task) return null

  const duration = durationInSeconds(task.started_at, task.completed_at)
  const fields: { label: string; value: string | number | null | undefined }[] = [
    { label: t("drawer.fields.taskId"), value: task.id },
    { label: t("drawer.fields.type"), value: t(`type.${getTaskTypeKey(task.task_type)}`) },
    { label: t("drawer.fields.model"), value: task.model },
    { label: t("drawer.fields.status"), value: getTaskStatusLabel(task.status, t) },
    { label: t("drawer.fields.user"), value: task.user_id },
    { label: t("drawer.fields.resolution"), value: task.width && task.height ? `${task.width}x${task.height}` : null },
    { label: t("drawer.fields.cost"), value: currencyFormatter.format(task.cost_user) },
    { label: t("drawer.fields.duration"), value: duration != null ? formatDuration(duration, t) : null },
    { label: t("drawer.fields.errorCode"), value: task.error_code },
    { label: t("drawer.fields.created"), value: dateTimeFormatter.format(new Date(task.created_at)) },
    { label: t("drawer.fields.started"), value: task.started_at ? dateTimeFormatter.format(new Date(task.started_at)) : null },
    { label: t("drawer.fields.completed"), value: task.completed_at ? dateTimeFormatter.format(new Date(task.completed_at)) : null },
  ]

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 flex h-full w-full max-w-lg flex-col border-l border-white/10 bg-[var(--surface,#0a0a0f)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/5 px-6 py-4">
          <div className="flex items-center gap-2">
            <ImageIcon className="size-4 text-[var(--primary)]" />
            <h2 className="text-sm font-semibold text-[var(--foreground)]">{t("drawer.title")}</h2>
          </div>
          <button
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-white/5 hover:text-[var(--foreground)] transition-colors cursor-pointer"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <div className="flex items-center gap-2">
            <AdminStatusBadge text={getTaskStatusLabel(task.status, t)} tone={getStatusTone(task.status)} />
            <AdminStatusBadge
              text={t(`type.${getTaskTypeKey(task.task_type)}`)}
              tone={getTaskTypeTone(task.task_type)}
              dot={false}
            />
          </div>

          <div className="space-y-3">
            {fields.map(
              (field) =>
                field.value != null && (
                  <div key={field.label} className="flex items-start justify-between gap-4">
                    <span className="shrink-0 text-xs text-[var(--muted)]">{field.label}</span>
                    <span className="text-right font-mono text-xs text-[var(--foreground)] break-all">
                      {field.value}
                    </span>
                  </div>
                )
            )}
          </div>

          {task.prompt_raw && (
            <div className="space-y-2">
              <span className="text-xs font-medium text-[var(--muted)]">{t("drawer.prompt")}</span>
              <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3 text-xs leading-relaxed text-[var(--foreground)]">
                {task.prompt_raw}
              </div>
            </div>
          )}

          {task.error_code && (
            <div className="space-y-2">
              <span className="text-xs font-medium text-rose-400">{t("drawer.errorDetails")}</span>
              <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3 text-xs text-rose-300">
                <span className="font-mono font-semibold">{task.error_code}</span>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <span className="text-xs font-medium text-[var(--muted)]">{t("drawer.outputsTitle")}</span>
            {outputsLoading && <p className="text-xs text-[var(--muted)]">{t("drawer.outputsLoading")}</p>}
            {outputsError && <p className="text-xs text-rose-400">{t("drawer.outputsFailed")}</p>}
            {!outputsLoading && !outputsError && outputs.length === 0 && (
              <p className="text-xs text-[var(--muted)]">{t("drawer.outputsEmpty")}</p>
            )}
            {!outputsLoading && !outputsError && outputs.length > 0 && (
              <div className="space-y-3">
                {outputs.map((output) => {
                  const previewable = Boolean(
                    output.source_url && output.content_type?.toLowerCase().startsWith("image/")
                  )
                  return (
                    <div key={output.id} className="rounded-lg border border-white/10 bg-white/[0.02] p-2">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="font-mono text-[10px] text-[var(--foreground)]">
                          #{output.output_index}
                        </span>
                        {output.source_url && (
                          <a
                            href={output.source_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[10px] text-[var(--primary)] hover:underline"
                          >
                            <ExternalLink className="size-3" />
                            {t("drawer.openSource")}
                          </a>
                        )}
                      </div>
                      <div className="space-y-1 text-[10px] text-[var(--muted)]">
                        <div>{t("drawer.outputMeta.contentType")}: {output.content_type ?? "—"}</div>
                        <div>{t("drawer.outputMeta.size")}: {output.size_bytes ?? "—"}</div>
                        <div>
                          {t("drawer.outputMeta.resolution")}:{" "}
                          {output.width && output.height ? `${output.width}x${output.height}` : "—"}
                        </div>
                        <div>{t("drawer.outputMeta.created")}: {formatDateTime(output.created_at, locale)}</div>
                      </div>
                      {previewable && (
                        <img
                          src={output.source_url ?? ""}
                          alt={t("drawer.previewAlt", { index: output.output_index })}
                          className="mt-2 w-full rounded-md border border-white/10 bg-black/20 object-cover"
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export function PageContent() {
  const t = useTranslations("admin.generationTasksPage")
  const locale = useLocale()
  const numberFormatter = new Intl.NumberFormat(locale)
  const decimalFormatter = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  const currencyFormatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  const costCellFormatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  })
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
  })
  const timeFormatter = new Intl.DateTimeFormat(locale, {
    timeStyle: "medium",
  })
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [typeFilter, setTypeFilter] = useState("")
  const [refreshInterval, setRefreshInterval] = useState(0)
  const [selectedTask, setSelectedTask] = useState<GenerationTaskItem | null>(null)
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date())
  const [shareSearchQuery, setShareSearchQuery] = useState("")
  const [shareActiveFilter, setShareActiveFilter] = useState("")
  const [shareFeedback, setShareFeedback] = useState<string | null>(null)
  const [actioningShareId, setActioningShareId] = useState<string | null>(null)
  const [openingTaskId, setOpeningTaskId] = useState<string | null>(null)

  const { data, error, isLoading, mutate } = useSWR(
    ["/api/v1/admin/generation-tasks", statusFilter, typeFilter],
    () =>
      fetchAdminGenerationTasks({
        limit: 100,
        status: statusFilter || undefined,
        task_type: typeFilter || undefined,
      }),
    {
      refreshInterval: refreshInterval || undefined,
      onSuccess: () => {
        setLastRefreshed(new Date())
      },
    }
  )

  const {
    data: sharesData,
    error: sharesError,
    isLoading: sharesLoading,
    mutate: mutateShares,
  } = useSWR(
    ["/api/v1/admin/generation-shares", shareActiveFilter],
    () =>
      fetchAdminGenerationShares({
        limit: 100,
        is_active:
          shareActiveFilter === "active"
            ? true
            : shareActiveFilter === "inactive"
              ? false
              : undefined,
      })
  )

  const {
    data: outputsData,
    error: outputsError,
    isLoading: outputsLoading,
  } = useSWR(
    selectedTask ? ["/api/v1/admin/generation-tasks/outputs", selectedTask.id] : null,
    () => fetchAdminGenerationTaskOutputs(selectedTask!.id)
  )

  const handleManualRefresh = useCallback(() => {
    mutate()
    mutateShares()
  }, [mutate, mutateShares])

  const allRows = useMemo(() => data?.items ?? [], [data?.items])

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return allRows
    return allRows.filter((row) =>
      [row.id, row.model, row.prompt_raw, row.user_id, row.error_code].some((value) =>
        String(value ?? "").toLowerCase().includes(query)
      )
    )
  }, [allRows, searchQuery])

  const allShares = useMemo(() => sharesData?.items ?? [], [sharesData?.items])
  const taskOutputs = useMemo(() => outputsData?.items ?? [], [outputsData?.items])
  const normalizedOutputsError = outputsError instanceof Error ? outputsError : null
  const filteredShares = useMemo(() => {
    const query = shareSearchQuery.trim().toLowerCase()
    if (!query) return allShares
    return allShares.filter((row) =>
      [row.id, row.task_id, row.user_id, row.model, row.prompt].some((value) =>
        String(value ?? "").toLowerCase().includes(query)
      )
    )
  }, [allShares, shareSearchQuery])

  const total = allRows.length
  const succeeded = allRows.filter((item) => item.status === "succeeded").length
  const running = allRows.filter((item) => item.status === "running" || item.status === "queued").length
  const successRate = total > 0 ? (succeeded / total) * 100 : 0
  const totalCost = allRows.reduce((sum, item) => sum + (item.cost_user ?? 0), 0)
  const completedTasks = allRows.filter((item) => item.started_at && item.completed_at)
  const avgDuration =
    completedTasks.length > 0
      ? Math.round(
          completedTasks.reduce((sum, item) => sum + (durationInSeconds(item.started_at, item.completed_at) ?? 0), 0) /
            completedTasks.length
        )
      : 0

  const stats: StatCardData[] = [
    { label: t("stats.totalTasks"), value: numberFormatter.format(total), icon: Zap, color: "primary" },
    {
      label: t("stats.successRate"),
      value: `${decimalFormatter.format(successRate)}%`,
      icon: TrendingUp,
      color: "emerald",
      subtitle: t("stats.successSubtitle", {
        succeeded: numberFormatter.format(succeeded),
        total: numberFormatter.format(total),
      }),
    },
    { label: t("stats.totalCost"), value: currencyFormatter.format(totalCost), icon: DollarSign, color: "amber" },
    {
      label: t("stats.avgDuration"),
      value: avgDuration > 0 ? formatDuration(avgDuration, t) : "—",
      icon: Clock,
      color: "teal",
      subtitle: t("stats.runningTasks", { count: numberFormatter.format(running) }),
    },
  ]

  const typeDistribution = useMemo(() => {
    const counts: Record<string, number> = {}
    allRows.forEach((row) => {
      counts[row.task_type] = (counts[row.task_type] || 0) + 1
    })
    return Object.entries(counts).map(([key, value]) => ({
      label: t(`type.${getTaskTypeKey(key)}`),
      value,
      color: TYPE_COLORS[key],
    }))
  }, [allRows, t])

  const statusDistribution = useMemo(() => {
    const counts: Record<string, number> = {}
    allRows.forEach((row) => {
      counts[row.status] = (counts[row.status] || 0) + 1
    })
    return Object.entries(counts).map(([key, value]) => ({
      label: getTaskStatusLabel(key, t),
      value,
      color: STATUS_CHART_COLORS[key] ?? "rgb(148,163,184)",
    }))
  }, [allRows, t])

  const columns: ColumnDef<GenerationTaskItem>[] = [
    {
      key: "task_type",
      header: t("table.headers.type"),
      render: (row) => (
        <AdminStatusBadge
          text={t(`type.${getTaskTypeKey(row.task_type)}`)}
          tone={getTaskTypeTone(row.task_type)}
          dot={false}
        />
      ),
    },
    {
      key: "model",
      header: t("table.headers.model"),
      render: (row) => <span className="font-mono text-xs text-[var(--muted)]">{row.model}</span>,
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
      render: (row) => <AdminStatusBadge text={getTaskStatusLabel(row.status, t)} tone={getStatusTone(row.status)} />,
    },
    {
      key: "prompt_raw",
      header: t("table.headers.prompt"),
      render: (row) => (
        <span className="inline-block max-w-[220px] truncate text-xs text-[var(--muted)]" title={row.prompt_raw}>
          {row.prompt_raw}
        </span>
      ),
    },
    {
      key: "width",
      header: t("table.headers.resolution"),
      render: (row) =>
        row.width && row.height ? (
          <span className="font-mono text-xs text-[var(--muted)]">
            {row.width}x{row.height}
          </span>
        ) : (
          <span className="text-[var(--muted)]">—</span>
        ),
    },
    {
      key: "cost_user",
      header: t("table.headers.cost"),
      align: "right",
      sortable: true,
      render: (row) => <span className="font-mono text-xs">{costCellFormatter.format(row.cost_user)}</span>,
    },
    {
      key: "completed_at",
      header: t("table.headers.duration"),
      render: (row) => {
        const seconds = durationInSeconds(row.started_at, row.completed_at)
        return seconds != null ? (
          <span className="text-xs text-[var(--muted)]">{formatDuration(seconds, t)}</span>
        ) : (
          <span className="text-[var(--muted)]">—</span>
        )
      },
    },
    {
      key: "error_code",
      header: t("table.headers.error"),
      render: (row) =>
        row.error_code ? (
          <span className="font-mono text-xs text-rose-400">{row.error_code}</span>
        ) : (
          <span className="text-[var(--muted)]">—</span>
        ),
    },
    {
      key: "created_at",
      header: t("table.headers.created"),
      sortable: true,
      render: (row) => (
        <span className="text-xs text-[var(--muted)]">{dateFormatter.format(new Date(row.created_at))}</span>
      ),
    },
  ]

  const shareColumns: ColumnDef<GenerationShareItem>[] = [
    {
      key: "task_id",
      header: t("shares.table.headers.task"),
      render: (row) => <span className="font-mono text-xs text-[var(--foreground)]">{shortId(row.task_id)}</span>,
    },
    {
      key: "user_id",
      header: t("shares.table.headers.user"),
      render: (row) => <span className="font-mono text-xs text-[var(--muted)]">{shortId(row.user_id)}</span>,
    },
    {
      key: "model",
      header: t("shares.table.headers.model"),
      render: (row) => <span className="font-mono text-xs text-[var(--muted)]">{row.model}</span>,
    },
    {
      key: "is_active",
      header: t("shares.table.headers.status"),
      render: (row) => (
        <AdminStatusBadge
          text={row.is_active ? t("shares.status.active") : t("shares.status.inactive")}
          tone={row.is_active ? "success" : "error"}
        />
      ),
    },
    {
      key: "shared_at",
      header: t("shares.table.headers.sharedAt"),
      render: (row) => (
        <span className="text-xs text-[var(--muted)]">{dateFormatter.format(new Date(row.shared_at))}</span>
      ),
    },
    {
      key: "prompt",
      header: t("shares.table.headers.prompt"),
      render: (row) => (
        <span className="inline-block max-w-[260px] truncate text-xs text-[var(--muted)]" title={row.prompt ?? ""}>
          {row.prompt || "—"}
        </span>
      ),
    },
  ]

  const handleToggleShare = async (row: GenerationShareItem) => {
    if (actioningShareId) return
    const nextActive = !row.is_active
    if (
      !window.confirm(
        row.is_active
          ? t("shares.confirm.deactivate", { id: shortId(row.id) })
          : t("shares.confirm.activate", { id: shortId(row.id) })
      )
    ) {
      return
    }

    setActioningShareId(row.id)
    setShareFeedback(null)
    try {
      await updateAdminGenerationShareActive(row.id, nextActive)
      setShareFeedback(
        nextActive
          ? t("shares.feedback.activated", { id: shortId(row.id) })
          : t("shares.feedback.deactivated", { id: shortId(row.id) })
      )
      await mutateShares()
    } catch (actionError) {
      const message =
        actionError instanceof Error ? actionError.message : t("shares.feedback.updateFailed")
      setShareFeedback(message)
    } finally {
      setActioningShareId(null)
    }
  }

  const handleOpenTaskFromShare = async (taskId: string) => {
    if (openingTaskId) return
    setOpeningTaskId(taskId)
    setShareFeedback(null)
    try {
      const existing = allRows.find((row) => row.id === taskId)
      if (existing) {
        setSelectedTask(existing)
        return
      }
      const task = await fetchAdminGenerationTask(taskId)
      setSelectedTask(task)
    } catch (openError) {
      const message =
        openError instanceof Error ? openError.message : t("shares.feedback.openTaskFailed")
      setShareFeedback(message)
    } finally {
      setOpeningTaskId(null)
    }
  }

  const refreshIntervals = [
    { label: t("refresh.off"), value: 0 },
    { label: t("refresh.tenSeconds"), value: 10_000 },
    { label: t("refresh.thirtySeconds"), value: 30_000 },
    { label: t("refresh.sixtySeconds"), value: 60_000 },
  ]

  const csvColumns: CsvColumn[] = [
    { key: "id", label: t("csv.id") },
    { key: "task_type", label: t("csv.taskType") },
    { key: "model", label: t("csv.model") },
    { key: "user_id", label: t("csv.user") },
    { key: "status", label: t("csv.status") },
    { key: "prompt_raw", label: t("csv.prompt") },
    { key: "width", label: t("csv.width") },
    { key: "height", label: t("csv.height") },
    { key: "cost_user", label: t("csv.cost") },
    { key: "error_code", label: t("csv.error") },
    { key: "created_at", label: t("csv.created") },
    { key: "started_at", label: t("csv.started") },
    { key: "completed_at", label: t("csv.completed") },
  ]

  const refreshActions = (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1.5">
        <RefreshCw
          className={`size-3.5 text-[var(--muted)] ${refreshInterval > 0 ? "animate-spin" : ""}`}
          style={refreshInterval > 0 ? { animationDuration: "3s" } : undefined}
        />
        <select
          value={refreshInterval}
          onChange={(event) => setRefreshInterval(Number(event.target.value))}
          className="h-7 rounded-md border border-white/10 bg-white/5 px-2 text-xs text-[var(--foreground)] focus:border-[var(--primary)]/50 focus:outline-none cursor-pointer"
        >
          {refreshIntervals.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <button
        onClick={handleManualRefresh}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 text-xs text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-white/10 transition-colors cursor-pointer"
        title={t("actions.lastRefreshed", { time: timeFormatter.format(lastRefreshed) })}
      >
        <RefreshCw className="size-3.5" />
        {t("actions.refresh")}
      </button>

      <button
        onClick={() => downloadCSV(filteredRows, `generation-tasks-${new Date().toISOString().slice(0, 10)}.csv`, csvColumns)}
        disabled={filteredRows.length === 0}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 text-xs text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-white/10 transition-colors cursor-pointer disabled:opacity-30"
      >
        <Download className="size-3.5" />
        {t("actions.export")}
      </button>
    </div>
  )

  return (
    <>
      <AdminStatCards stats={stats} columns={4} />

      {allRows.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          <GlassCard padding="default" hover="none">
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
                {t("charts.typeDistribution")}
              </span>
            </div>
            <div className="flex items-center justify-center gap-8">
              <DonutChart
                value={succeeded}
                total={Math.max(total, 1)}
                size={80}
                strokeWidth={8}
                color="rgb(52,211,153)"
                label={`${decimalFormatter.format(successRate)}%`}
              />
              <div className="space-y-2">
                {typeDistribution.map((item) => (
                  <div key={item.label} className="flex items-center gap-2">
                    <div className="size-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                    <span className="text-xs text-[var(--muted)]">{item.label}</span>
                    <span className="text-xs font-medium text-[var(--foreground)]">{numberFormatter.format(item.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          </GlassCard>

          <GlassCard padding="default" hover="none">
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
                {t("charts.statusBreakdown")}
              </span>
            </div>
            <BarChartMini data={statusDistribution} height={120} />
          </GlassCard>
        </div>
      )}

      <AdminFilterBar
        searchPlaceholder={t("filters.searchPlaceholder")}
        onSearch={setSearchQuery}
        onFilterChange={(key, value) => {
          if (key === "type") setTypeFilter(value)
          if (key === "status") setStatusFilter(value)
        }}
        filters={[
          {
            key: "type",
            label: t("filters.type"),
            options: [
              { label: t("type.image"), value: "image_generation" },
              { label: t("type.tts"), value: "text_to_speech" },
              { label: t("type.video"), value: "video_generation" },
            ],
          },
          {
            key: "status",
            label: t("filters.status"),
            options: [
              { label: t("status.queued"), value: "queued" },
              { label: t("status.running"), value: "running" },
              { label: t("status.succeeded"), value: "succeeded" },
              { label: t("status.failed"), value: "failed" },
              { label: t("status.canceled"), value: "canceled" },
            ],
          },
        ]}
        actions={refreshActions}
      />

      <AdminDataTable
        columns={columns}
        data={filteredRows}
        onRowClick={(row) => setSelectedTask(row)}
        emptyMessage={
          isLoading
            ? t("empty.loading")
            : error
              ? t("empty.failed")
              : t("empty.noData")
        }
      />

      <GlassCard padding="default" hover="none">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[var(--foreground)]">{t("shares.title")}</h3>
            <p className="mt-1 text-xs text-[var(--muted)]">{t("shares.description")}</p>
          </div>
        </div>

        <AdminFilterBar
          searchPlaceholder={t("shares.filters.searchPlaceholder")}
          onSearch={setShareSearchQuery}
          onFilterChange={(key, value) => {
            if (key === "active") setShareActiveFilter(value)
          }}
          filters={[
            {
              key: "active",
              label: t("shares.filters.active"),
              options: [
                { label: t("shares.status.active"), value: "active" },
                { label: t("shares.status.inactive"), value: "inactive" },
              ],
            },
          ]}
        />

        {shareFeedback && <p className="mb-2 text-xs text-[var(--muted)]">{shareFeedback}</p>}

        <AdminDataTable
          columns={shareColumns}
          data={filteredShares}
          onRowClick={(row) => {
            void handleOpenTaskFromShare(row.task_id)
          }}
          emptyMessage={
            sharesLoading
              ? t("shares.empty.loading")
              : sharesError
                ? t("shares.empty.failed")
                : t("shares.empty.noData")
          }
          rowActions={(row) => (
            <div className="inline-flex items-center gap-1">
              <button
                onClick={(event) => {
                  event.stopPropagation()
                  void handleOpenTaskFromShare(row.task_id)
                }}
                disabled={Boolean(openingTaskId)}
                className="inline-flex h-7 cursor-pointer items-center rounded-lg border border-sky-400/30 px-2 text-xs text-sky-300 transition-colors hover:bg-sky-500/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t("shares.actions.openTask")}
              </button>
              <button
                onClick={(event) => {
                  event.stopPropagation()
                  void handleToggleShare(row)
                }}
                disabled={Boolean(actioningShareId)}
                className="inline-flex h-7 cursor-pointer items-center rounded-lg border border-white/10 px-2 text-xs text-[var(--muted)] transition-colors hover:bg-white/10 hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {row.is_active ? t("shares.actions.deactivate") : t("shares.actions.activate")}
              </button>
            </div>
          )}
        />
      </GlassCard>

      <TaskDetailDrawer
        task={selectedTask}
        outputs={taskOutputs}
        outputsLoading={outputsLoading}
        outputsError={normalizedOutputsError}
        onClose={() => setSelectedTask(null)}
      />
    </>
  )
}
