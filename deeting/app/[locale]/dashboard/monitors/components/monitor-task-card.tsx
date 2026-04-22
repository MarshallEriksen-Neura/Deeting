"use client"

import { useMemo, useState } from "react"
import {
  Bot,
  Clock3,
  FileText,
  Pause,
  Play,
  RotateCw,
  Trash2,
  Wrench,
} from "lucide-react"
import { toast } from "sonner"

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/shadcn/card"
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
  type MonitorDeliveryStateRecord,
  type MonitorTask,
} from "@/lib/api/monitors"
import { useMonitorDeliveryStates } from "@/lib/swr/use-monitors"

interface MonitorTaskCardProps {
  task: MonitorTask
  onEdit: (task: MonitorTask) => void
  onViewLogs: (taskId: string) => void
  onRefresh: () => void
  onTrigger: (task: MonitorTask) => Promise<void>
  isTriggering?: boolean
}

const STATUS_META = {
  active: { label: "运行中", tone: "text-emerald-700" },
  paused: { label: "已暂停", tone: "text-amber-700" },
  failed_suspended: { label: "已挂起", tone: "text-red-700" },
  binding_required: { label: "待绑定", tone: "text-amber-700" },
  binding_invalid: { label: "绑定失效", tone: "text-red-700" },
} as const

const ANALYSIS_MODE_LABEL = {
  concise: "精简",
  deep: "深度",
  alert_first: "预警优先",
} as const

export function MonitorTaskCard({
  task,
  onEdit,
  onViewLogs,
  onRefresh,
  onTrigger,
  isTriggering = false,
}: MonitorTaskCardProps) {
  const [acting, setActing] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const { data: deliveryStates } = useMonitorDeliveryStates(task.id)
  const statusMeta = STATUS_META[task.display_status]
  const bindingReady = task.binding_state === "ok"

  const deliverySummary = useMemo(
    () => summarizeDeliveryStates(deliveryStates?.items ?? []),
    [deliveryStates?.items],
  )

  async function handleToggle() {
    setActing(true)
    try {
      if (task.status === "active") {
        await pauseMonitorTask(task.id)
        toast.success("任务已暂停")
      } else {
        await resumeMonitorTask(task.id)
        toast.success("任务已恢复")
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
      toast.success("任务已删除")
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
              {statusMeta.label}
            </span>
          </div>
          <div className="flex gap-1.5">
            <Badge
              variant="outline"
              className="rounded-sm border-[color:var(--border)] px-1.5 py-0 text-[10px] font-medium"
            >
              {ANALYSIS_MODE_LABEL[task.analysis_mode]}
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
                Frequency
              </span>
              <p className="text-xs font-medium">{formatInterval(task.current_interval_minutes)}</p>
            </div>
            <div className="space-y-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                Tokens Used
              </span>
              <p className="text-xs font-medium">{formatNumber(task.total_tokens)}</p>
            </div>
            <div className="space-y-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                Agent Binding
              </span>
              <div className="flex items-center gap-1.5">
                <span className={cn("size-1 rounded-full", bindingReady ? "bg-emerald-500" : "bg-amber-500")} />
                <p className="truncate text-xs font-medium">
                  {task.task_agent_name || task.assistant_name || "System Base"}
                </p>
              </div>
            </div>
            <div className="space-y-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                Next Scheduled
              </span>
              <p className="text-xs font-medium">
                {task.next_run_at ? formatDateTime(task.next_run_at) : "Pending"}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between border-t border-[color:var(--border)] pt-4">
          <div className="flex gap-1">
            <button
              onClick={() => onViewLogs(task.id)}
              className="flex size-7 items-center justify-center rounded border border-[color:var(--border)] transition-colors hover:bg-muted"
              title="日志"
            >
              <FileText className="size-3.5" />
            </button>
            <button
              onClick={() => onEdit(task)}
              className="flex size-7 items-center justify-center rounded border border-[color:var(--border)] transition-colors hover:bg-muted"
              title="编辑"
            >
              <Wrench className="size-3.5" />
            </button>
            <button
              onClick={() => setDeleteOpen(true)}
              className="flex size-7 items-center justify-center rounded border border-[color:var(--border)] text-destructive transition-colors hover:bg-destructive/10"
              title="删除"
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
              立即触发
            </Button>
            <button
              onClick={() => void handleToggle()}
              disabled={acting || isTriggering || (!bindingReady && task.status !== "active")}
              className="flex items-center gap-1.5 px-2 text-[11px] font-bold tracking-wider text-primary uppercase transition-opacity hover:opacity-80 disabled:opacity-50"
            >
              {task.status === "active" ? (
                <>
                  <Pause className="size-3" />
                  PAUSE
                </>
              ) : (
                <>
                  <Play className="size-3" />
                  RESUME
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除这个主动寻猎任务？</AlertDialogTitle>
            <AlertDialogDescription>
              删除后会移除任务配置和后续调度。已有执行日志是否保留取决于本地运行时存储策略。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={acting}>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleDelete()} disabled={acting}>
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function Metric({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: string
  icon: typeof Clock3
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-muted/30 p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </div>
      <div className="mt-2 text-sm font-medium">{value}</div>
    </div>
  )
}

function summarizeDeliveryStates(states: MonitorDeliveryStateRecord[]) {
  const labels = new Set<string>()

  for (const item of states) {
    const channel = item.channel_kind?.toLowerCase() || ""
    if (channel === "feishu") labels.add(item.status === "anchored" ? "飞书已建锚点" : "飞书待建锚点")
    if (channel === "telegram") labels.add(item.status === "anchored" ? "Telegram 已建锚点" : "Telegram 待建锚点")
    if (channel === "wechat") labels.add(item.status === "context_ready" ? "微信上下文已建立" : "微信等待联系人先发消息")
  }

  return Array.from(labels).slice(0, 3)
}

function formatInterval(minutes: number | null) {
  if (!minutes) return "未设置"
  if (minutes >= 1440) return `每 ${Math.round(minutes / 1440)} 天`
  if (minutes >= 60) return `每 ${Math.round(minutes / 60)} 小时`
  return `每 ${minutes} 分钟`
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
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
