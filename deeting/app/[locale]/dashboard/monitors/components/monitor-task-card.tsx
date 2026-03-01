"use client"

import { useState, useEffect, useCallback } from "react"
import {
  Play,
  Pause,
  Zap,
  Clock,
  Loader2,
  Coins,
  Bot,
  MoreHorizontal,
  FileText,
  Pencil,
  Trash2,
  TrendingUp,
} from "lucide-react"
import { GlassCard } from "@/components/ui/glass-card"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import type { MonitorTask } from "@/lib/api/monitors"
import {
  pauseMonitorTask,
  resumeMonitorTask,
  deleteMonitorTask,
} from "@/lib/api/monitors"

interface MonitorTaskCardProps {
  task: MonitorTask
  onEdit: (task: MonitorTask) => void
  onViewLogs: (taskId: string) => void
  onRefresh: () => void
  onTrigger: (task: MonitorTask) => Promise<void>
  isTriggering?: boolean
}

const STATUS_CONFIG = {
  active: {
    dot: "bg-emerald-400",
    ring: "ring-emerald-400/20",
    label: "运行中",
    bg: "bg-emerald-500/5",
  },
  paused: {
    dot: "bg-amber-400",
    ring: "ring-amber-400/20",
    label: "已暂停",
    bg: "bg-amber-500/5",
  },
  failed_suspended: {
    dot: "bg-red-400",
    ring: "ring-red-400/20",
    label: "已挂起",
    bg: "bg-red-500/5",
  },
} as const

export function MonitorTaskCard({
  task,
  onEdit,
  onViewLogs,
  onRefresh,
  onTrigger,
  isTriggering = false,
}: MonitorTaskCardProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [acting, setActing] = useState(false)
  const config = STATUS_CONFIG[task.status]

  const handleToggle = useCallback(async () => {
    setActing(true)
    try {
      if (task.status === "active") {
        await pauseMonitorTask(task.id)
        toast.success("任务已暂停")
      } else {
        await resumeMonitorTask(task.id)
        toast.success("任务已恢复运行")
      }
      onRefresh()
    } catch {
      toast.error("操作失败，请重试")
    } finally {
      setActing(false)
    }
  }, [task.id, task.status, onRefresh])

  const handleTrigger = useCallback(async () => {
    setActing(true)
    try {
      await onTrigger(task)
    } finally {
      setActing(false)
    }
  }, [onTrigger, task])

  const handleDelete = useCallback(async () => {
    if (!confirm("确定要删除该寻猎任务？此操作不可逆。")) return
    setActing(true)
    try {
      await deleteMonitorTask(task.id)
      toast.success("任务已删除")
      onRefresh()
    } catch {
      toast.error("删除失败，请重试")
    } finally {
      setActing(false)
    }
  }, [task.id, onRefresh])

  return (
    <GlassCard
      className={cn(
        "group relative flex flex-col transition-all duration-300",
        "hover:-translate-y-1 hover:shadow-[0_16px_48px_-12px_rgba(0,0,0,0.15)]",
        config.bg
      )}
      padding="default"
      hover="none"
    >
      {/* Header: status + title + menu */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={cn(
              "h-2 w-2 shrink-0 rounded-full ring-4",
              config.dot,
              config.ring
            )}
          />
          <h3 className="truncate text-sm font-semibold text-[var(--foreground)]">
            {task.title}
          </h3>
          {isTriggering && (
            <span className="shrink-0 rounded-md bg-sky-500/15 px-2 py-0.5 text-[10px] font-medium text-sky-400">
              执行中
            </span>
          )}
        </div>
        <div className="relative shrink-0">
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="rounded-lg p-1 text-[var(--muted)] transition-colors hover:bg-[var(--foreground)]/5 hover:text-[var(--foreground)]"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {menuOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setMenuOpen(false)}
              />
              <div className="absolute right-0 top-8 z-50 w-36 rounded-xl border border-white/10 bg-[var(--card)] p-1 shadow-xl backdrop-blur-xl">
                <MenuButton
                  icon={Pencil}
                  label="编辑"
                  onClick={() => {
                    setMenuOpen(false)
                    onEdit(task)
                  }}
                />
                <MenuButton
                  icon={FileText}
                  label="执行日志"
                  onClick={() => {
                    setMenuOpen(false)
                    onViewLogs(task.id)
                  }}
                />
                <MenuButton
                  icon={Zap}
                  label="立即触发"
                  onClick={() => {
                    setMenuOpen(false)
                    handleTrigger()
                  }}
                  disabled={acting || isTriggering || task.status !== "active"}
                />
                <div className="my-1 h-px bg-white/5" />
                <MenuButton
                  icon={Trash2}
                  label="删除"
                  onClick={() => {
                    setMenuOpen(false)
                    handleDelete()
                  }}
                  destructive
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Objective excerpt */}
      <p className="mb-4 line-clamp-2 text-xs leading-relaxed text-[var(--muted)]">
        {task.objective}
      </p>

      {/* Metrics row */}
      <div className="mb-4 grid grid-cols-3 gap-3">
        <MetricPill
          icon={Clock}
          label={formatInterval(task.current_interval_minutes)}
        />
        <MetricPill
          icon={Coins}
          label={formatTokens(task.total_tokens)}
        />
        <MetricPill
          icon={TrendingUp}
          label={`${task.error_count}次失败`}
        />
      </div>

      {/* MAB Evolution Bar */}
      <EvolutionBar variants={task.strategy_variants} />

      {/* Countdown + Next run */}
      <div className="mt-3 mb-4">
        <CountdownTimer
          nextRunAt={task.next_run_at}
          status={task.status}
          isTriggering={isTriggering}
        />
      </div>

      {/* Footer actions */}
      <div className="mt-auto flex items-center gap-2 pt-2 border-t border-white/5">
        <button
          onClick={handleToggle}
          disabled={acting || isTriggering}
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
            task.status === "active"
              ? "bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
              : "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20",
            acting && "opacity-50 pointer-events-none"
          )}
        >
          {task.status === "active" ? (
            <>
              <Pause className="h-3 w-3" /> 暂停
            </>
          ) : (
            <>
              <Play className="h-3 w-3" /> 恢复
            </>
          )}
        </button>
        {task.assistant_id && (
          <a
            href={`/chat?assistant=${task.assistant_id}`}
            className="ml-auto flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--foreground)]/5 hover:text-[var(--foreground)]"
          >
            <Bot className="h-3 w-3" />
            寻猎者
          </a>
        )}
      </div>
    </GlassCard>
  )
}

// --- Sub-components ---

function MetricPill({ icon: Icon, label }: { icon: typeof Clock; label: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg bg-[var(--foreground)]/[0.03] px-2 py-1.5">
      <Icon className="h-3 w-3 shrink-0 text-[var(--muted)]" />
      <span className="truncate text-[11px] font-medium text-[var(--muted)]">
        {label}
      </span>
    </div>
  )
}

function MenuButton({
  icon: Icon,
  label,
  onClick,
  destructive,
  disabled,
}: {
  icon: typeof Pencil
  label: string
  onClick: () => void
  destructive?: boolean
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-colors",
        destructive
          ? "text-red-400 hover:bg-red-500/10"
          : "text-[var(--foreground)] hover:bg-[var(--foreground)]/5",
        disabled && "opacity-40 pointer-events-none"
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  )
}

function EvolutionBar({
  variants,
}: {
  variants: MonitorTask["strategy_variants"]
}) {
  const prompts = variants?.prompts
  if (!prompts || prompts.length === 0) return null

  const total = prompts.length
  const colors = [
    "bg-[var(--primary)]",
    "bg-emerald-400",
    "bg-amber-400",
    "bg-teal-400",
    "bg-rose-400",
  ]

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--muted)]">
          MAB 策略分布
        </span>
        <span className="text-[10px] text-[var(--muted)]">
          {total} 个策略臂
        </span>
      </div>
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-[var(--foreground)]/5">
        {prompts.map((p, i) => (
          <div
            key={p.id}
            className={cn("h-full transition-all duration-500", colors[i % colors.length])}
            style={{ width: `${100 / total}%` }}
            title={p.label}
          />
        ))}
      </div>
    </div>
  )
}

function CountdownTimer({
  nextRunAt,
  status,
  isTriggering,
}: {
  nextRunAt: string | null
  status: MonitorTask["status"]
  isTriggering: boolean
}) {
  const [nowMs, setNowMs] = useState(() => Date.now())
  const canCountdown = !isTriggering && Boolean(nextRunAt) && status === "active"

  useEffect(() => {
    if (!canCountdown) return
    const id = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [canCountdown])

  const remaining = (() => {
    if (!canCountdown) return ""
    const diff = new Date(nextRunAt!).getTime() - nowMs
    if (diff <= 0) return "即将执行..."
    const h = Math.floor(diff / 3_600_000)
    const m = Math.floor((diff % 3_600_000) / 60_000)
    const s = Math.floor((diff % 60_000) / 1_000)
    return h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`
  })()

  if (isTriggering) {
    return (
      <div className="flex items-center gap-1.5 text-[11px] text-sky-400">
        <Loader2 className="h-3 w-3 animate-spin" />
        正在执行研判...
      </div>
    )
  }

  if (!remaining) {
    return (
      <div className="text-[11px] text-[var(--muted)]">
        {status === "paused" ? "已暂停调度" : status === "failed_suspended" ? "因连续失败挂起" : "等待调度..."}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
      </span>
      <span className="text-[11px] font-medium tabular-nums text-[var(--foreground)]">
        下次执行: {remaining}
      </span>
    </div>
  )
}

// --- Helpers ---

function formatInterval(minutes: number | null): string {
  if (!minutes) return "未设定"
  if (minutes >= 1440) return `每${Math.round(minutes / 1440)}天`
  if (minutes >= 60) return `每${Math.round(minutes / 60)}小时`
  return `每${minutes}分钟`
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}
