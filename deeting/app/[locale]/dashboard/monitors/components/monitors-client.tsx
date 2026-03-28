"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { Plus, Crosshair, RefreshCw } from "lucide-react"
import { AnimatePresence, motion } from "framer-motion"
import { toast } from "sonner"

import { Container } from "@/components/ui/container"
import { useMonitorTasks } from "@/lib/swr/use-monitors"
import {
  fetchMonitorLogs,
  triggerMonitorTask,
  type MonitorTask,
  type MonitorStatus,
} from "@/lib/api/monitors"

import { MonitorTaskCard } from "./monitor-task-card"
import { MonitorCreateModal } from "./monitor-create-modal"
import { MonitorExecutionLog } from "./monitor-execution-log"
import { MonitorEmptyState } from "./monitor-empty-state"

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

  const queryParams = statusFilter === "all" ? undefined : { status: statusFilter }
  const { data: tasks, isLoading, mutate: mutateTasks } = useMonitorTasks(queryParams)

  const refreshAll = useCallback(() => {
    mutateTasks()
  }, [mutateTasks])

  useEffect(() => {
    return () => {
      mountedRef.current = false
    }
  }, [])

  const clearPendingTrigger = useCallback((taskId: string) => {
    setPendingTriggerByTask((prev) => {
      if (!prev[taskId]) return prev
      const next = { ...prev }
      delete next[taskId]
      return next
    })
  }, [])

  const trackTriggerResult = useCallback(
    async (task: MonitorTask, startedAtIso: string) => {
      const startedAtMs = Date.parse(startedAtIso)
      const toleranceMs = 2_000
      const maxRounds = 30

      for (let round = 0; round < maxRounds; round++) {
        await new Promise((resolve) => setTimeout(resolve, 4_000))
        try {
          const logs = await fetchMonitorLogs(task.id, { skip: 0, limit: 10 })
          const latest = logs.items.find((item) => Date.parse(item.triggered_at) >= startedAtMs - toleranceMs)
          if (!latest) {
            continue
          }

          if (latest.status === "success") {
            toast.success("本次执行完成")
          } else if (latest.status === "failure") {
            toast.error(latest.error_message || "本次执行失败")
          } else {
            toast("本次执行已跳过")
          }

          if (mountedRef.current) {
            clearPendingTrigger(task.id)
            refreshAll()
          }
          return
        } catch {
          // ignore transient polling errors
        }
      }

      if (mountedRef.current) {
        clearPendingTrigger(task.id)
        refreshAll()
        toast("执行仍在进行中，可稍后查看日志")
      }
    },
    [clearPendingTrigger, refreshAll]
  )

  const handleTrigger = useCallback(
    async (task: MonitorTask) => {
      const startedAtIso = new Date().toISOString()
      let accepted = false
      setPendingTriggerByTask((prev) => {
        if (prev[task.id]) return prev
        accepted = true
        return { ...prev, [task.id]: startedAtIso }
      })
      if (!accepted) return

      try {
        await triggerMonitorTask(task.id)
        toast.success("已提交执行，正在等待结果...")
        refreshAll()
        void trackTriggerResult(task, startedAtIso)
      } catch {
        if (mountedRef.current) {
          clearPendingTrigger(task.id)
        }
        toast.error("触发失败，请重试")
      }
    },
    [clearPendingTrigger, refreshAll, trackTriggerResult]
  )

  const handleEdit = useCallback((task: MonitorTask) => {
    setEditingTask(task)
    setCreateOpen(true)
  }, [])

  const handleCreateClose = useCallback(() => {
    setCreateOpen(false)
    setEditingTask(null)
  }, [])

  return (
    <Container
      as="main"
      gutter="md"
      size="full"
      className="py-6 md:py-8 !mx-0 !max-w-none"
    >
      {/* Header */}
      <div className="mb-8 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--primary)]/10">
            <Crosshair className="h-5 w-5 text-[var(--primary)]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[var(--foreground)] md:text-3xl">
              主动寻猎
            </h1>
            <p className="mt-0.5 text-sm text-[var(--muted)]">
              任务配置、手动触发与执行记录
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refreshAll()}
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-[var(--foreground)]/[0.03] px-3.5 py-2.5 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--foreground)]/[0.06]"
          >
            <RefreshCw className="h-4 w-4" />
            刷新记录
          </button>
          <button
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-2 rounded-xl bg-[var(--primary)] px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-[var(--primary)]/20 transition-all hover:shadow-xl hover:shadow-[var(--primary)]/30 hover:-translate-y-0.5 active:translate-y-0"
          >
            <Plus className="h-4 w-4" />
            新建寻猎任务
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="mb-6 flex items-center gap-2">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setStatusFilter(f.value)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
              statusFilter === f.value
                ? "bg-[var(--primary)]/15 text-[var(--primary)]"
                : "text-[var(--muted)] hover:bg-[var(--foreground)]/5 hover:text-[var(--foreground)]"
            }`}
          >
            {f.label}
          </button>
        ))}
        <div className="ml-auto text-xs text-[var(--muted)] tabular-nums">
          {tasks?.total ?? 0} 个任务
        </div>
      </div>

      {/* Task Grid */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-52 animate-pulse rounded-2xl bg-[var(--card)]/40 border border-white/5"
            />
          ))}
        </div>
      ) : !tasks?.items?.length ? (
        <MonitorEmptyState onCreate={() => setCreateOpen(true)} />
      ) : (
        <motion.div
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
          layout
        >
          <AnimatePresence mode="popLayout">
            {tasks.items.map((task, index) => (
              <motion.div
                key={task.id}
                layout
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.3, delay: index * 0.05 }}
              >
                <MonitorTaskCard
                  task={task}
                  onEdit={handleEdit}
                  onViewLogs={setLogTaskId}
                  onRefresh={refreshAll}
                  onTrigger={handleTrigger}
                  isTriggering={Boolean(pendingTriggerByTask[task.id])}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      {/* Create/Edit Modal */}
      <MonitorCreateModal
        open={createOpen}
        onOpenChange={handleCreateClose}
        editTask={editingTask}
        onSuccess={refreshAll}
      />

      {/* Execution Log Drawer */}
      <MonitorExecutionLog
        taskId={logTaskId}
        onClose={() => setLogTaskId(null)}
      />
    </Container>
  )
}
