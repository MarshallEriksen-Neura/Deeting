"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { Crosshair, Plus, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { Container } from "@/components/ui/common/container"
import { Button } from "@/components/ui/shadcn/button"
import { useMonitorTasks } from "@/lib/swr/use-monitors"
import { fetchMonitorLogs, triggerMonitorTask, type MonitorStatus, type MonitorTask } from "@/lib/api/monitors"

import { MonitorCreateModal } from "./monitor-create-modal"
import { MonitorEmptyState } from "./monitor-empty-state"
import { MonitorExecutionLog } from "./monitor-execution-log"
import { MonitorTaskCard } from "./monitor-task-card"

export function MonitorsClient() {
  const t = useTranslations("monitoring")
  const [statusFilter, setStatusFilter] = useState<MonitorStatus | "all">("all")
  const [createOpen, setCreateOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<MonitorTask | null>(null)
  const [logTaskId, setLogTaskId] = useState<string | null>(null)
  const [pendingTriggerByTask, setPendingTriggerByTask] = useState<Record<string, string>>({})
  const mountedRef = useRef(true)
  const query = statusFilter === "all" ? undefined : { status: statusFilter }
  const { data, isLoading, mutate } = useMonitorTasks(query)
  const statusFilters = useMemo<Array<{ label: string; value: MonitorStatus | "all" }>>(
    () => [
      { label: t("monitors.filters.all"), value: "all" },
      { label: t("monitors.filters.active"), value: "active" },
      { label: t("monitors.filters.paused"), value: "paused" },
      { label: t("monitors.filters.failedSuspended"), value: "failed_suspended" },
    ],
    [t],
  )

  useEffect(() => {
    return () => {
      mountedRef.current = false
    }
  }, [])

  const refreshAll = useCallback(() => {
    void mutate()
  }, [mutate])

  const clearPendingTrigger = useCallback((taskId: string) => {
    setPendingTriggerByTask((current) => {
      if (!current[taskId]) return current
      const next = { ...current }
      delete next[taskId]
      return next
    })
  }, [])

  const trackTriggerResult = useCallback(
    async (task: MonitorTask, startedAtIso: string) => {
      const startedAtMs = Date.parse(startedAtIso)
      const toleranceMs = 2_000

      for (let round = 0; round < 20; round += 1) {
        await new Promise((resolve) => setTimeout(resolve, 3_000))

        try {
          const logs = await fetchMonitorLogs(task.id, { skip: 0, limit: 10 })
          const matched = logs.items.find((item) => Date.parse(item.triggered_at) >= startedAtMs - toleranceMs)
          if (!matched) continue

          if (matched.status === "success") toast.success(t("monitors.toast.executionCompleted"))
          if (matched.status === "failure") {
            toast.error(matched.error_message || t("monitors.toast.executionFailed"))
          }
          if (matched.status === "skipped") toast(t("monitors.toast.executionSkipped"))

          if (mountedRef.current) {
            clearPendingTrigger(task.id)
            refreshAll()
          }
          return
        } catch {
          // Ignore transient polling failures.
        }
      }

      if (mountedRef.current) {
        clearPendingTrigger(task.id)
        refreshAll()
        toast(t("monitors.toast.checkLogsLater"))
      }
    },
    [clearPendingTrigger, refreshAll, t],
  )

  const handleTrigger = useCallback(
    async (task: MonitorTask) => {
      const startedAtIso = new Date().toISOString()
      let accepted = false

      setPendingTriggerByTask((current) => {
        if (current[task.id]) return current
        accepted = true
        return { ...current, [task.id]: startedAtIso }
      })
      if (!accepted) return

      try {
        await triggerMonitorTask(task.id)
        toast.success(t("monitors.toast.triggerSubmitted"))
        refreshAll()
        void trackTriggerResult(task, startedAtIso)
      } catch {
        clearPendingTrigger(task.id)
        toast.error(t("monitors.toast.triggerFailed"))
      }
    },
    [clearPendingTrigger, refreshAll, t, trackTriggerResult],
  )

  return (
    <Container as="main" gutter="md" size="full" className="min-h-screen !mx-0 !max-w-none bg-[color:var(--background)]">
      <div className="flex flex-col border-b border-[color:var(--border)] bg-[color:var(--card)] px-6 py-8 md:px-10">
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <div className="flex size-6 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Crosshair className="size-3.5" />
              </div>
              <span className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
                {t("monitors.header.eyebrow")}
              </span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
              {t("monitors.header.title")}
            </h1>
            <p className="max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
              {t("monitors.header.description")}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={refreshAll}
              className="h-9 border-[color:var(--border)] bg-transparent px-4 font-medium transition-colors hover:bg-muted"
            >
              <RefreshCw className="mr-2 size-3.5" />
              {t("monitors.actions.refresh")}
            </Button>
            <Button
              variant="ios-primary"
              size="sm"
              onClick={() => setCreateOpen(true)}
              className="h-9 px-5 font-medium shadow-none"
            >
              <Plus className="mr-2 size-4" />
              {t("monitors.actions.create")}
            </Button>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-1.5">
          {statusFilters.map((filter) => (
            <button
              key={filter.value}
              onClick={() => setStatusFilter(filter.value)}
              className={`
                px-3 py-1.5 text-xs font-medium transition-all
                ${
                  statusFilter === filter.value
                    ? "rounded-md bg-foreground text-background"
                    : "rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                }
              `}
            >
              {filter.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2 text-[11px] font-medium text-muted-foreground uppercase tracking-widest">
            <span className="inline-block size-1.5 rounded-full bg-primary" />
            {t("monitors.header.totalScanners", { count: data?.total ?? 0 })}
          </div>
        </div>
      </div>

      <div className="px-6 py-8 md:px-10">
        {isLoading ? (
          <div className="grid gap-px overflow-hidden rounded-xl border border-[color:var(--border)] bg-[color:var(--border)] md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="h-80 animate-pulse bg-card" />
            ))}
          </div>
        ) : data?.items?.length ? (
          <div className="grid gap-px overflow-hidden rounded-xl border border-[color:var(--border)] bg-[color:var(--border)] md:grid-cols-2 lg:grid-cols-3">
            {data.items.map((task) => (
              <MonitorTaskCard
                key={task.id}
                task={task}
                onEdit={(nextTask) => {
                  setEditingTask(nextTask)
                  setCreateOpen(true)
                }}
                onViewLogs={setLogTaskId}
                onRefresh={refreshAll}
                onTrigger={handleTrigger}
                isTriggering={Boolean(pendingTriggerByTask[task.id])}
              />
            ))}
          </div>
        ) : (
          <MonitorEmptyState onCreate={() => setCreateOpen(true)} />
        )}
      </div>

      <MonitorCreateModal
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open)
          if (!open) {
            setEditingTask(null)
          }
        }}
        editTask={editingTask}
        onSuccess={refreshAll}
      />

      <MonitorExecutionLog taskId={logTaskId} onClose={() => setLogTaskId(null)} />
    </Container>
  )
}
