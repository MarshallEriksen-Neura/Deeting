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
      active: { label: t("monitors.taskCard.status.active"), tone: "text-emerald-700" },
      paused: { label: t("monitors.taskCard.status.paused"), tone: "text-amber-700" },
      failed_suspended: { label: t("monitors.taskCard.status.failedSuspended"), tone: "text-red-700" },
      binding_required: { label: t("monitors.taskCard.status.bindingRequired"), tone: "text-amber-700" },
      binding_invalid: { label: t("monitors.taskCard.status.bindingInvalid"), tone: "text-red-700" },
    }),
    [t],
  )

  const analysisModeLabel = useMemo(
    () => ({
      concise: t("monitors.modal.analysisModes.concise.label"),
      deep: t("monitors.modal.analysisModes.deep.label"),
      alert_first: t("monitors.modal.analysisModes.alertFirst.label"),
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

  const ledColor =
    task.display_status === "active"
      ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"
      : task.display_status === "paused"
        ? "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]"
        : "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]"

  return (
    <>
      <div className="group flex h-full flex-col bg-[color:var(--card)] p-6 transition-colors hover:bg-muted/30">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <div className={cn("size-1.5 rounded-full", ledColor)} />
            <span className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
              {statusMeta[task.display_status].label}
            </span>
          </div>
          <div className="flex gap-1.5">
            <Badge
              variant="outline"
              className="rounded-sm border-[color:var(--border)] px-1.5 py-0 text-[10px] font-medium"
            >
              {analysisModeLabel[task.analysis_mode]}
            </Badge>
          </div>
        </div>

        <div className="mt-4 flex-1">
          <h3 className="line-clamp-1 text-sm font-semibold tracking-tight text-foreground">
            {task.title}
          </h3>
          <p className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">
            {task.objective}
          </p>

          <div className="mt-5 grid grid-cols-2 gap-x-8 gap-y-4 border-t border-[color:var(--border)] pt-4">
            <div className="space-y-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                {t("monitors.taskCard.labels.frequency")}
              </span>
              <p className="text-xs font-medium">{formatInterval(task.current_interval_minutes, t)}</p>
            </div>
            <div className="space-y-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                {t("monitors.taskCard.labels.tokens")}
              </span>
              <p className="text-xs font-medium">{formatNumber(task.total_tokens)}</p>
            </div>
            <div className="space-y-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                {t("monitors.taskCard.labels.agentBinding")}
              </span>
              <div className="flex items-center gap-1.5">
                <span className={cn("size-1 rounded-full", bindingReady ? "bg-emerald-500" : "bg-amber-500")} />
                <p className="truncate text-xs font-medium">
                  {task.task_agent_name || task.assistant_name || t("monitors.taskCard.systemBase")}
                </p>
              </div>
            </div>
            <div className="space-y-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                {t("monitors.taskCard.labels.nextScheduled")}
              </span>
              <p className="text-xs font-medium">
                {task.next_run_at ? formatDateTime(task.next_run_at, locale) : t("monitors.taskCard.pending")}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between border-t border-[color:var(--border)] pt-4">
          <div className="flex gap-1">
            <button
              onClick={() => onViewLogs(task.id)}
              className="flex size-7 items-center justify-center rounded border border-[color:var(--border)] transition-colors hover:bg-muted"
              title={t("monitors.taskCard.actions.logs")}
            >
              <FileText className="size-3.5" />
            </button>
            <button
              onClick={() => onEdit(task)}
              className="flex size-7 items-center justify-center rounded border border-[color:var(--border)] transition-colors hover:bg-muted"
              title={t("monitors.taskCard.actions.edit")}
            >
              <Wrench className="size-3.5" />
            </button>
            <button
              onClick={() => setDeleteOpen(true)}
              className="flex size-7 items-center justify-center rounded border border-[color:var(--border)] text-destructive transition-colors hover:bg-destructive/10"
              title={t("monitors.taskCard.actions.delete")}
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void onTrigger(task)}
              disabled={acting || isTriggering || task.status !== "active" || !bindingReady}
              className="h-8 border-[color:var(--border)] px-3 text-[11px] font-medium"
            >
              <RotateCw className={cn("mr-1.5 size-3", isTriggering && "animate-spin")} />
              {t("monitors.taskCard.actions.triggerNow")}
            </Button>
            <button
              onClick={() => void handleToggle()}
              disabled={acting || isTriggering || (!bindingReady && task.status !== "active")}
              className="flex items-center gap-1.5 px-2 text-[11px] font-bold tracking-wider text-primary uppercase transition-opacity hover:opacity-80 disabled:opacity-50"
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
