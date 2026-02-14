"use client"

import { useMemo, useState, useCallback, useEffect, useRef } from "react"
import useSWR from "swr"
import { Image, RefreshCw, Download, X, Clock, DollarSign, TrendingUp, Zap } from "lucide-react"
import {
  AdminPageShell,
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
  fetchAdminGenerationTasks,
  type GenerationTaskItem,
} from "@/lib/api/admin-dashboard"

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function shortId(value?: string | null) {
  if (!value) return "—"
  return `${value.slice(0, 8)}...`
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

function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s}s`
}

function downloadCSV(rows: GenerationTaskItem[], filename: string) {
  const headers = ["id", "task_type", "model", "user_id", "status", "prompt_raw", "width", "height", "cost_user", "error_code", "created_at", "started_at", "completed_at"]
  const csvRows = [
    headers.join(","),
    ...rows.map((row) =>
      headers
        .map((h) => {
          const val = row[h as keyof GenerationTaskItem]
          const str = String(val ?? "")
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

const TYPE_LABEL: Record<string, string> = {
  image_generation: "Image",
  text_to_speech: "Audio",
  video_generation: "Video",
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

const REFRESH_INTERVALS = [
  { label: "Off", value: 0 },
  { label: "10s", value: 10_000 },
  { label: "30s", value: 30_000 },
  { label: "60s", value: 60_000 },
]

/* ------------------------------------------------------------------ */
/*  Task Detail Drawer                                                 */
/* ------------------------------------------------------------------ */

function TaskDetailDrawer({
  task,
  onClose,
}: {
  task: GenerationTaskItem | null
  onClose: () => void
}) {
  if (!task) return null

  const duration = durationInSeconds(task.started_at, task.completed_at)
  const fields: { label: string; value: string | number | null | undefined }[] = [
    { label: "Task ID", value: task.id },
    { label: "Type", value: TYPE_LABEL[task.task_type] || task.task_type },
    { label: "Model", value: task.model },
    { label: "Status", value: task.status },
    { label: "User", value: task.user_id },
    { label: "Resolution", value: task.width && task.height ? `${task.width}x${task.height}` : null },
    { label: "Cost", value: `$${task.cost_user.toFixed(4)}` },
    { label: "Duration", value: duration != null ? formatDuration(duration) : null },
    { label: "Error Code", value: task.error_code },
    { label: "Created", value: new Date(task.created_at).toLocaleString() },
    { label: "Started", value: task.started_at ? new Date(task.started_at).toLocaleString() : null },
    { label: "Completed", value: task.completed_at ? new Date(task.completed_at).toLocaleString() : null },
  ]

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      {/* Drawer */}
      <div className="fixed right-0 top-0 z-50 flex h-full w-full max-w-lg flex-col border-l border-white/10 bg-[var(--surface,#0a0a0f)] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/5 px-6 py-4">
          <div className="flex items-center gap-2">
            <Image className="size-4 text-[var(--primary)]" />
            <h2 className="text-sm font-semibold text-[var(--foreground)]">Task Details</h2>
          </div>
          <button
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-white/5 hover:text-[var(--foreground)] transition-colors cursor-pointer"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Status badge */}
          <div className="flex items-center gap-2">
            <AdminStatusBadge text={task.status} tone={getStatusTone(task.status)} />
            <AdminStatusBadge
              text={TYPE_LABEL[task.task_type] || task.task_type}
              tone={task.task_type === "image_generation" ? "primary" : task.task_type === "text_to_speech" ? "teal" : "info"}
              dot={false}
            />
          </div>

          {/* Fields */}
          <div className="space-y-3">
            {fields.map(
              (f) =>
                f.value != null && (
                  <div key={f.label} className="flex items-start justify-between gap-4">
                    <span className="shrink-0 text-xs text-[var(--muted)]">{f.label}</span>
                    <span className="text-right font-mono text-xs text-[var(--foreground)] break-all">
                      {f.value}
                    </span>
                  </div>
                )
            )}
          </div>

          {/* Prompt */}
          {task.prompt_raw && (
            <div className="space-y-2">
              <span className="text-xs font-medium text-[var(--muted)]">Prompt</span>
              <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3 text-xs leading-relaxed text-[var(--foreground)]">
                {task.prompt_raw}
              </div>
            </div>
          )}

          {/* Error details */}
          {task.error_code && (
            <div className="space-y-2">
              <span className="text-xs font-medium text-rose-400">Error Details</span>
              <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3 text-xs text-rose-300">
                <span className="font-mono font-semibold">{task.error_code}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export function PageContent() {
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [typeFilter, setTypeFilter] = useState("")
  const [refreshInterval, setRefreshInterval] = useState(0)
  const [selectedTask, setSelectedTask] = useState<GenerationTaskItem | null>(null)

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
    }
  )

  /* Auto-refresh countdown */
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date())
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (data) setLastRefreshed(new Date())
  }, [data])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  const handleManualRefresh = useCallback(() => {
    mutate()
  }, [mutate])

  /* Data */
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

  /* Enhanced stats */
  const total = allRows.length
  const succeeded = allRows.filter((i) => i.status === "succeeded").length
  const running = allRows.filter((i) => i.status === "running" || i.status === "queued").length
  const failed = allRows.filter((i) => i.status === "failed").length
  const successRate = total > 0 ? ((succeeded / total) * 100).toFixed(1) : "0.0"
  const totalCost = allRows.reduce((sum, i) => sum + (i.cost_user ?? 0), 0)
  const completedTasks = allRows.filter((i) => i.started_at && i.completed_at)
  const avgDuration =
    completedTasks.length > 0
      ? Math.round(
          completedTasks.reduce((sum, i) => sum + (durationInSeconds(i.started_at, i.completed_at) ?? 0), 0) /
            completedTasks.length
        )
      : 0

  const stats: StatCardData[] = [
    { label: "Total Tasks", value: total, icon: Zap, color: "primary" },
    { label: "Success Rate", value: `${successRate}%`, icon: TrendingUp, color: "emerald", subtitle: `${succeeded}/${total}` },
    { label: "Total Cost", value: `$${totalCost.toFixed(2)}`, icon: DollarSign, color: "amber" },
    { label: "Avg Duration", value: avgDuration > 0 ? formatDuration(avgDuration) : "—", icon: Clock, color: "teal", subtitle: `${running} running` },
  ]

  /* Chart data */
  const typeDistribution = useMemo(() => {
    const counts: Record<string, number> = {}
    allRows.forEach((r) => {
      counts[r.task_type] = (counts[r.task_type] || 0) + 1
    })
    return Object.entries(counts).map(([key, value]) => ({
      label: TYPE_LABEL[key] || key,
      value,
      color: TYPE_COLORS[key],
    }))
  }, [allRows])

  const statusDistribution = useMemo(() => {
    const counts: Record<string, number> = {}
    allRows.forEach((r) => {
      counts[r.status] = (counts[r.status] || 0) + 1
    })
    return Object.entries(counts).map(([key, value]) => ({
      label: key,
      value,
      color: STATUS_CHART_COLORS[key] ?? "rgb(148,163,184)",
    }))
  }, [allRows])

  /* Table columns */
  const columns: ColumnDef<GenerationTaskItem>[] = [
    {
      key: "task_type",
      header: "Type",
      render: (row) => (
        <AdminStatusBadge
          text={TYPE_LABEL[row.task_type] || row.task_type}
          tone={
            row.task_type === "image_generation"
              ? "primary"
              : row.task_type === "text_to_speech"
                ? "teal"
                : "info"
          }
          dot={false}
        />
      ),
    },
    {
      key: "model",
      header: "Model",
      render: (row) => <span className="font-mono text-xs text-[var(--muted)]">{row.model}</span>,
    },
    {
      key: "user_id",
      header: "User",
      sortable: true,
      render: (row) => <span className="font-mono text-xs">{shortId(row.user_id)}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <AdminStatusBadge text={row.status} tone={getStatusTone(row.status)} />,
    },
    {
      key: "prompt_raw",
      header: "Prompt",
      render: (row) => (
        <span className="inline-block max-w-[220px] truncate text-xs text-[var(--muted)]" title={row.prompt_raw}>
          {row.prompt_raw}
        </span>
      ),
    },
    {
      key: "width",
      header: "Resolution",
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
      header: "Cost",
      align: "right",
      sortable: true,
      render: (row) => <span className="font-mono text-xs">${row.cost_user.toFixed(3)}</span>,
    },
    {
      key: "completed_at",
      header: "Duration",
      render: (row) => {
        const seconds = durationInSeconds(row.started_at, row.completed_at)
        return seconds != null ? (
          <span className="text-xs text-[var(--muted)]">{formatDuration(seconds)}</span>
        ) : (
          <span className="text-[var(--muted)]">—</span>
        )
      },
    },
    {
      key: "error_code",
      header: "Error",
      render: (row) =>
        row.error_code ? (
          <span className="font-mono text-xs text-rose-400">{row.error_code}</span>
        ) : (
          <span className="text-[var(--muted)]">—</span>
        ),
    },
    {
      key: "created_at",
      header: "Created",
      sortable: true,
      render: (row) => (
        <span className="text-xs text-[var(--muted)]">{new Date(row.created_at).toLocaleDateString()}</span>
      ),
    },
  ]

  /* Actions bar items */
  const refreshActions = (
    <div className="flex items-center gap-2">
      {/* Auto-refresh selector */}
      <div className="flex items-center gap-1.5">
        <RefreshCw
          className={`size-3.5 text-[var(--muted)] ${refreshInterval > 0 ? "animate-spin" : ""}`}
          style={refreshInterval > 0 ? { animationDuration: "3s" } : undefined}
        />
        <select
          value={refreshInterval}
          onChange={(e) => setRefreshInterval(Number(e.target.value))}
          className="h-7 rounded-md border border-white/10 bg-white/5 px-2 text-xs text-[var(--foreground)] focus:border-[var(--primary)]/50 focus:outline-none cursor-pointer"
        >
          {REFRESH_INTERVALS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Manual refresh */}
      <button
        onClick={handleManualRefresh}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 text-xs text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-white/10 transition-colors cursor-pointer"
        title={`Last: ${lastRefreshed.toLocaleTimeString()}`}
      >
        <RefreshCw className="size-3.5" />
        Refresh
      </button>

      {/* CSV Export */}
      <button
        onClick={() => downloadCSV(filteredRows, `generation-tasks-${new Date().toISOString().slice(0, 10)}.csv`)}
        disabled={filteredRows.length === 0}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 text-xs text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-white/10 transition-colors cursor-pointer disabled:opacity-30"
      >
        <Download className="size-3.5" />
        Export
      </button>
    </div>
  )

  return (
    <AdminPageShell title="Generation Tasks" description="Monitor image, audio, and video generation tasks" icon={Image}>
      {/* Enhanced stat cards */}
      <AdminStatCards stats={stats} columns={4} />

      {/* Charts row */}
      {allRows.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          <GlassCard padding="default" hover="none">
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
                Type Distribution
              </span>
            </div>
            <div className="flex items-center justify-center gap-8">
              <DonutChart
                value={succeeded}
                total={total}
                size={80}
                strokeWidth={8}
                color="rgb(52,211,153)"
                label={`${successRate}%`}
              />
              <div className="space-y-2">
                {typeDistribution.map((item) => (
                  <div key={item.label} className="flex items-center gap-2">
                    <div className="size-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                    <span className="text-xs text-[var(--muted)]">{item.label}</span>
                    <span className="text-xs font-medium text-[var(--foreground)]">{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </GlassCard>

          <GlassCard padding="default" hover="none">
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
                Status Breakdown
              </span>
            </div>
            <BarChartMini data={statusDistribution} height={120} />
          </GlassCard>
        </div>
      )}

      {/* Filter bar with actions */}
      <AdminFilterBar
        searchPlaceholder="Search by ID, model, prompt, user, error..."
        onSearch={setSearchQuery}
        onFilterChange={(key, value) => {
          if (key === "type") setTypeFilter(value)
          if (key === "status") setStatusFilter(value)
        }}
        filters={[
          {
            key: "type",
            label: "Type",
            options: [
              { label: "Image", value: "image_generation" },
              { label: "TTS", value: "text_to_speech" },
              { label: "Video", value: "video_generation" },
            ],
          },
          {
            key: "status",
            label: "Status",
            options: [
              { label: "Queued", value: "queued" },
              { label: "Running", value: "running" },
              { label: "Succeeded", value: "succeeded" },
              { label: "Failed", value: "failed" },
              { label: "Canceled", value: "canceled" },
            ],
          },
        ]}
        actions={refreshActions}
      />

      {/* Data table with row click */}
      <AdminDataTable
        columns={columns}
        data={filteredRows}
        onRowClick={(row) => setSelectedTask(row)}
        emptyMessage={
          isLoading
            ? "Loading generation tasks..."
            : error
              ? "Failed to load generation tasks"
              : "No generation tasks found"
        }
      />

      {/* Detail drawer */}
      <TaskDetailDrawer task={selectedTask} onClose={() => setSelectedTask(null)} />
    </AdminPageShell>
  )
}
