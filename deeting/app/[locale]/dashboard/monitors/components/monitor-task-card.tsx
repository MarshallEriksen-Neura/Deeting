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

  return (
    <>
      <Card className="h-full justify-between">
        <CardHeader>
          <CardTitle className="flex items-start gap-3 text-base leading-6">
            <div className="min-w-0 flex-1">
              <div className="truncate">{task.title}</div>
              <CardDescription className="mt-2 line-clamp-2">{task.objective}</CardDescription>
            </div>
          </CardTitle>
          <CardAction className="flex flex-wrap justify-end gap-2">
            <Badge variant="secondary" className={statusMeta.tone}>
              {statusMeta.label}
            </Badge>
            <Badge variant="outline">{ANALYSIS_MODE_LABEL[task.analysis_mode]}</Badge>
          </CardAction>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {task.task_agent_name || task.assistant_name || task.task_agent_id || task.assistant_id ? (
              <Badge variant="secondary">
                <Bot className="mr-1 size-3.5" />
                {task.task_agent_name || task.assistant_name || task.task_agent_id || task.assistant_id}
              </Badge>
            ) : null}
            <Badge variant={bindingReady ? "secondary" : "outline"}>
              {bindingReady ? "绑定正常" : task.binding_state === "binding_required" ? "等待绑定" : "绑定失效"}
            </Badge>
          </div>

          {task.binding_error ? (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-300">
              {task.binding_error}
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-3">
            <Metric label="频率" value={formatInterval(task.current_interval_minutes)} icon={Clock3} />
            <Metric label="累计 tokens" value={formatNumber(task.total_tokens)} icon={RotateCw} />
            <Metric label="失败次数" value={String(task.error_count)} icon={Wrench} />
          </div>

          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between text-muted-foreground">
              <span>下次执行</span>
              <span>{task.next_run_at ? formatDateTime(task.next_run_at) : "等待调度"}</span>
            </div>
            {deliverySummary.length ? (
              <div className="flex flex-wrap gap-2">
                {deliverySummary.map((item) => (
                  <Badge key={item} variant="outline">
                    {item}
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>
        </CardContent>

        <CardFooter className="flex flex-wrap justify-between gap-2 border-t">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => onViewLogs(task.id)}>
              <FileText className="size-4" />
              日志
            </Button>
            <Button variant="outline" size="sm" onClick={() => onEdit(task)}>
              <Wrench className="size-4" />
              编辑
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void onTrigger(task)}
              disabled={acting || isTriggering || task.status !== "active" || !bindingReady}
            >
              <RotateCw className={cn("size-4", isTriggering && "animate-spin")} />
              立即触发
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void handleToggle()}
              disabled={acting || isTriggering || (!bindingReady && task.status !== "active")}
            >
              {task.status === "active" ? <Pause className="size-4" /> : <Play className="size-4" />}
              {task.status === "active" ? "暂停" : "恢复"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDeleteOpen(true)} disabled={acting}>
              <Trash2 className="size-4" />
              删除
            </Button>
          </div>
        </CardFooter>
      </Card>

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
