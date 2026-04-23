"use client"

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import {
  FileText,
  Pause,
  Play,
  RotateCw,
  Trash2,
  Wrench,
  Clock,
  Cpu,
  CalendarClock,
  Zap,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/shadcn/button"
import { Badge } from "@/components/ui/shadcn/badge"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/shadcn/alert-dialog"
import { cn } from "@/lib/utils"
import {
  deleteMonitorTask,
  pauseMonitorTask,
  resumeMonitorTask,
  type MonitorTask,
} from "@/lib/api/monitors"

interface MonitorTaskCardProps {
  task: MonitorTask
  onEdit: (task: MonitorTask) => void
  onViewLogs: (taskId: string) => void
  onRefresh: () => void
  onTrigger: (task: MonitorTask) => Promise<void>
  isTriggering?: boolean
}

export function MonitorTaskCard({
  task,
  onEdit,
  onViewLogs,
  onRefresh,
  onTrigger,
  isTriggering = false,
}: MonitorTaskCardProps) {
  const t = useTranslations("monitoring")
  const locale = useLocale()
  const [acting, setActing] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const bindingReady = task.binding_state === "ok"

  const statusMeta = useMemo(
    () => ({
      active: {
        label: t("monitors.taskCard.status.active"),
        tone: "text-emerald-700",
        bg: "bg-emerald-50",
        border: "border-emerald-200",
        dot: "bg-emerald-500",
        glow: "shadow-[0_0_10px_rgba(16,185,129,0.45)]",
      },
      paused: {
        label: t("monitors.taskCard.status.paused"),
        tone: "text-amber-700",
        bg: "bg-amber-50",
        border: "border-amber-200",
        dot: "bg-amber-500",
        glow: "shadow-[0_0_10px_rgba(245,158,11,0.45)]",
      },
      failed_suspended: {
        label: t("monitors.taskCard.status.failedSuspended"),
        tone: "text-red-700",
        bg: "bg-red-50",
        border: "border-red-200",
        dot: "bg-red-500",
        glow: "shadow-[0_0_10px_rgba(239,68,68,0.45)]",
      },
      binding_required: {
        label: t("monitors.taskCard.status.bindingRequired"),
        tone: "text-amber-700",
        bg: "bg-amber-50",
        border: "border-amber-200",
        dot: "bg-amber-500",
        glow: "shadow-[0_0_10px_rgba(245,158,11,0.45)]",
      },
      binding_invalid: {
        label: t("monitors.taskCard.status.bindingInvalid"),
        tone: "text-red-700",
        bg: "bg-red-50",
        border: "border-red-200",
        dot: "bg-red-500",
        glow: "shadow-[0_0_10px_rgba(239,68,68,0.45)]",
      },
    }),
    [t],
  )

  const analysisModeMeta = useMemo(
    () => ({
      concise: {
        label: t("monitors.modal.analysisModes.concise.label"),
        icon: Zap,
        tone: "text-sky-700 bg-sky-50 border-sky-200",
      },
      deep: {
        label: t("monitors.modal.analysisModes.deep.label"),
        icon: Cpu,
        tone: "text-violet-700 bg-violet-50 border-violet-200",
      },
      alert_first: {
        label: t("monitors.modal.analysisModes.alertFirst.label"),
        icon: Clock,
        tone: "text-rose-700 bg-rose-50 border-rose-200",
      },
    }),
    [t],
  )

  async function handleToggle() {
    setActing(true)
    try {
      if (task.status === "active") {
        await pauseMonitorTask(task.id)
        toast.success(t("monitors.toast.taskPaused"))
      } else {
        await resumeMonitorTask(task.id)
        toast.success(t("monitors.toast.taskResumed"))
      }
      onRefresh()
    } finally {
      setActing(false)
    }
  }

  async function handleDelete() {
    setActing(true)
    try {
      await deleteMonitorTask(task.id)
      toast.success(t("monitors.toast.taskDeleted"))
      setDeleteOpen(false)
      onRefresh()
    } finally {
      setActing(false)
    }
  }

  const meta = statusMeta[task.display_status]
  const modeMeta = analysisModeMeta[task.analysis_mode]
  const ModeIcon = modeMeta.icon

  return (
    <>
      <div className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md">
        {/* Top accent bar */}
        <div
          className={cn(
            "h-1 w-full transition-colors duration-500",
            meta.dot,
            task.display_status === "active" && "opacity-80",
          )}
        />

        <div className="flex flex-1 flex-col p-5">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold tracking-wider uppercase",
                meta.bg,
                meta.border,
                meta.tone,
              )}
            >
              <span className={cn("size-1.5 rounded-full", meta.dot, meta.glow)} />
              {meta.label}
            </div>
            <div
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold",
                modeMeta.tone,
              )}
            >
              <ModeIcon className="size-3" />
              {modeMeta.label}
            </div>
          </div>

          {/* Title & Objective */}
          <div className="mt-4">
            <h3 className="line-clamp-1 text-[15px] font-semibold leading-snug tracking-tight text-foreground">
              {task.title}
            </h3>
            <p className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">
              {task.objective}
            </p>
          </div>

          {/* Meta Grid */}
          <div className="mt-5 grid grid-cols-2 gap-3">
            <MetaItem
              icon={<CalendarClock className="size-3" />}
              label={t("monitors.taskCard.labels.frequency")}
              value={formatInterval(task.current_interval_minutes, t)}
            />
            <MetaItem
              icon={<Zap className="size-3" />}
              label={t("monitors.taskCard.labels.tokens")}
              value={formatNumber(task.total_tokens)}
            />
            <MetaItem
              icon={
                <span
                  className={cn(
                    "size-2 rounded-full",
                    bindingReady ? "bg-emerald-500" : "bg-amber-500",
                  )}
                />
              }
              label={t("monitors.taskCard.labels.agentBinding")}
              value={task.task_agent_name || task.assistant_name || t("monitors.taskCard.systemBase")}
            />
            <MetaItem
              icon={<Clock className="size-3" />}
              label={t("monitors.taskCard.labels.nextScheduled")}
              value={
                task.next_run_at
                  ? formatDateTime(task.next_run_at, locale)
                  : t("monitors.taskCard.pending")
              }
            />
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between border-t border-[color:var(--border)] bg-muted/20 px-5 py-3">
          <div className="flex items-center gap-1">
            <IconButton
              onClick={() => onViewLogs(task.id)}
              title={t("monitors.taskCard.actions.logs")}
              icon={<FileText className="size-3.5" />}
            />
            <IconButton
              onClick={() => onEdit(task)}
              title={t("monitors.taskCard.actions.edit")}
              icon={<Wrench className="size-3.5" />}
            />
            <IconButton
              onClick={() => setDeleteOpen(true)}
              title={t("monitors.taskCard.actions.delete")}
              icon={<Trash2 className="size-3.5" />}
              destructive
            />
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void onTrigger(task)}
              disabled={acting || isTriggering || task.status !== "active" || !bindingReady}
              className="h-8 gap-1.5 rounded-lg border-[color:var(--border)] bg-[color:var(--card)] px-3 text-[11px] font-semibold shadow-sm transition-all hover:bg-muted hover:shadow"
            >
              <RotateCw className={cn("size-3", isTriggering && "animate-spin")} />
              {t("monitors.taskCard.actions.triggerNow")}
            </Button>
            <button
              onClick={() => void handleToggle()}
              disabled={acting || isTriggering || (!bindingReady && task.status !== "active")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-bold tracking-wider uppercase transition-all",
                task.status === "active"
                  ? "bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200"
                  : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200",
                "disabled:opacity-40",
              )}
            >
              {task.status === "active" ? (
                <>
                  <Pause className="size-3" />
                  {t("monitors.taskCard.actions.pause")}
                </>
              ) : (
                <>
                  <Play className="size-3" />
                  {t("monitors.taskCard.actions.resume")}
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("monitors.taskCard.deleteDialog.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("monitors.taskCard.deleteDialog.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={acting}>{t("monitors.taskCard.deleteDialog.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleDelete()} disabled={acting}>
              {t("monitors.taskCard.deleteDialog.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function MetaItem({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg bg-muted/40 p-2.5 transition-colors group-hover:bg-muted/60">
      <div className="mt-0.5 flex shrink-0 text-muted-foreground">{icon}</div>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p className="mt-0.5 truncate text-[11px] font-medium text-foreground">{value}</p>
      </div>
    </div>
  )
}

function IconButton({
  onClick,
  title,
  icon,
  destructive,
}: {
  onClick: () => void
  title: string
  icon: React.ReactNode
  destructive?: boolean
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        "flex size-8 items-center justify-center rounded-lg border border-[color:var(--border)] bg-[color:var(--card)] text-muted-foreground transition-all duration-200",
        "hover:scale-105 hover:text-foreground hover:shadow-sm",
        destructive && "hover:border-red-300 hover:bg-red-50 hover:text-red-600",
      )}
    >
      {icon}
    </button>
  )
}

function formatInterval(
  minutes: number | null,
  t: ReturnType<typeof useTranslations>,
) {
  if (!minutes) return t("monitors.taskCard.interval.notSet")
  if (minutes >= 1440) {
    return t("monitors.taskCard.interval.days", { count: Math.round(minutes / 1440) })
  }
  if (minutes >= 60) {
    return t("monitors.taskCard.interval.hours", { count: Math.round(minutes / 60) })
  }
  return t("monitors.taskCard.interval.minutes", { count: minutes })
}

function formatDateTime(value: string, locale: string) {
  return new Date(value).toLocaleString(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function formatNumber(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(value)
}
