"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Crosshair, Plus, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { Container } from "@/components/ui/common/container"
import { Button } from "@/components/ui/shadcn/button"
import { Badge } from "@/components/ui/shadcn/badge"
import { useMonitorTasks } from "@/lib/swr/use-monitors"
import { fetchMonitorLogs, triggerMonitorTask, type MonitorStatus, type MonitorTask } from "@/lib/api/monitors"

import { MonitorCreateModal } from "./monitor-create-modal"
import { MonitorEmptyState } from "./monitor-empty-state"
import { MonitorExecutionLog } from "./monitor-execution-log"
import { MonitorTaskCard } from "./monitor-task-card"

const STATUS_FILTERS: Array<{ label: string; value: MonitorStatus | "all" }> = [
  { label: "全部", value: "all" },
  { label: "运行中", value: "active" },
  { label: "已暂停", value: "paused" },
  { label: "已挂起", value: "failed_suspended" },
]

export function MonitorsClient() {
  const [statusFilter, setStatusFilter] = useState<MonitorStatus | "all">("all")
  const [createOpen, setCreateOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<MonitorTask | null>(null)
  const [logTaskId, setLogTaskId] = useState<string | null>(null)
  const [pendingTriggerByTask, setPendingTriggerByTask] = useState<Record<string, string>>({})
  const mountedRef = useRef(true)
  const query = statusFilter === "all" ? undefined : { status: statusFilter }
  const { data, isLoading, mutate } = useMonitorTasks(query)

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

          if (matched.status === "success") toast.success("本次执行已完成")
          if (matched.status === "failure") toast.error(matched.error_message || "本次执行失败")
          if (matched.status === "skipped") toast("本次执行被跳过")

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
        toast("执行结果稍后可在日志中查看")
      }
    },
    [clearPendingTrigger, refreshAll],
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
        toast.success("已提交执行，正在等待结果")
        refreshAll()
        void trackTriggerResult(task, startedAtIso)
      } catch {
        clearPendingTrigger(task.id)
        toast.error("触发失败，请重试")
      }
    },
    [clearPendingTrigger, refreshAll, trackTriggerResult],
  )

  return (
    <Container as="main" gutter="md" size="full" className="py-6 md:py-8 !mx-0 !max-w-none">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-[color:var(--ios-pill-border)] bg-[color:var(--ios-pill-muted)] px-3 py-1 text-xs text-muted-foreground">
            <Crosshair className="size-3.5" />
            桌面端本地主动寻猎
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">自动化与观测</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              这里仅保留桌面端主动寻猎任务、手动触发和执行日志，不引入旧项目的云端监控页。
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={refreshAll}>
            <RefreshCw className="size-4" />
            刷新
          </Button>
          <Button variant="ios-primary" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            新建任务
          </Button>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map((filter) => (
          <Button
            key={filter.value}
            variant={statusFilter === filter.value ? "ios-primary" : "secondary"}
            size="sm"
            onClick={() => setStatusFilter(filter.value)}
          >
            {filter.label}
          </Button>
        ))}
        <Badge variant="outline" className="ml-auto">
          共 {data?.total ?? 0} 个任务
        </Badge>
      </div>

      <div className="mt-6">
        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="h-72 animate-pulse rounded-2xl border bg-card" />
            ))}
          </div>
        ) : data?.items?.length ? (
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
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

