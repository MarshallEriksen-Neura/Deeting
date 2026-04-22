"use client"

import { useCallback } from "react"
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Coins,
  MinusCircle,
  ThumbsDown,
  ThumbsUp,
  XCircle,
} from "lucide-react"

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/shadcn/sheet"
import { Badge } from "@/components/ui/shadcn/badge"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/shadcn/card"
import { Button } from "@/components/ui/shadcn/button"
import { useMonitorDeliveryStates, useMonitorLogs } from "@/lib/swr/use-monitors"
import {
  submitMonitorFeedback,
  type MonitorDeliveryStateRecord,
  type MonitorExecutionLog as MonitorExecutionLogItem,
} from "@/lib/api/monitors"

interface MonitorExecutionLogProps {
  taskId: string | null
  onClose: () => void
}

const LOG_STATUS_META = {
  success: { label: "成功", icon: CheckCircle2, className: "text-emerald-600" },
  failure: { label: "失败", icon: XCircle, className: "text-red-600" },
  skipped: { label: "跳过", icon: MinusCircle, className: "text-amber-600" },
} as const

export function MonitorExecutionLog({ taskId, onClose }: MonitorExecutionLogProps) {
  const { data: logs, isLoading, mutate } = useMonitorLogs(taskId)
  const { data: deliveryStates } = useMonitorDeliveryStates(taskId)

  const handleFeedback = useCallback(
    async (log: MonitorExecutionLogItem, score: number) => {
      await submitMonitorFeedback(log.task_id, log.id, score)
      mutate()
    },
    [mutate],
  )

  return (
    <Sheet open={Boolean(taskId)} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>执行日志</SheetTitle>
          <SheetDescription>
            查看最近执行结果、交付锚点和人工反馈。
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          {deliveryStates?.items?.length ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">通知交付状态</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {deliveryStates.items.map((item) => (
                  <DeliveryStateRow key={`${item.channel_id}-${item.target_key}`} item={item} />
                ))}
              </CardContent>
            </Card>
          ) : null}

          {isLoading ? (
            Array.from({ length: 3 }).map((_, index) => (
              <Card key={index} className="animate-pulse">
                <CardContent className="h-28" />
              </Card>
            ))
          ) : logs?.items?.length ? (
            logs.items.map((log) => <LogCard key={log.id} log={log} onFeedback={handleFeedback} />)
          ) : (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center gap-3 py-12 text-center text-sm text-muted-foreground">
                <Clock3 className="size-8" />
                <div>还没有执行记录，首次触发后会在这里看到每次结果。</div>
              </CardContent>
            </Card>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function DeliveryStateRow({ item }: { item: MonitorDeliveryStateRecord }) {
  return (
    <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-sm">
      <div className="flex items-center gap-2">
        <Badge variant="secondary">{item.channel_kind || "channel"}</Badge>
        <span className="font-medium">{item.channel_display_name || item.target_key}</span>
        <span className="ml-auto text-xs text-muted-foreground">{deliveryStateLabel(item.status)}</span>
      </div>
      <div className="mt-2 text-xs text-muted-foreground">{item.target_key}</div>
    </div>
  )
}

function LogCard({
  log,
  onFeedback,
}: {
  log: MonitorExecutionLogItem
  onFeedback: (log: MonitorExecutionLogItem, score: number) => Promise<void>
}) {
  const meta = LOG_STATUS_META[log.status]
  const StatusIcon = meta.icon
  const events = log.output_data?.events ?? []
  const changeSummary = log.output_data?.change_summary

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className={meta.className}>
            <StatusIcon className="mr-1 size-3.5" />
            {meta.label}
          </Badge>
          {log.output_data?.is_significant_change ? (
            <Badge variant="outline">
              <AlertTriangle className="mr-1 size-3.5" />
              检测到显著变化
            </Badge>
          ) : null}
          <span className="ml-auto text-xs text-muted-foreground">{formatTime(log.triggered_at)}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {changeSummary ? <div className="leading-6">{changeSummary}</div> : null}
        {!changeSummary && log.error_message ? (
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-red-700 dark:text-red-300">
            {log.error_message}
          </div>
        ) : null}

        {events.length ? (
          <div className="space-y-2 border-l border-border/60 pl-4 text-xs text-muted-foreground">
            {events.slice(0, 8).map((event) => (
              <div key={event.event_id} className="space-y-1">
                <div className="font-medium text-foreground/90">{event.summary || event.step || event.kind}</div>
                <div>{event.stage || event.state || event.kind}</div>
              </div>
            ))}
          </div>
        ) : null}

        <div className="flex items-center gap-3 border-t border-border/60 pt-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Coins className="size-3.5" />
            {log.tokens_used} tokens
          </span>
          {log.status === "success" ? (
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => void onFeedback(log, 1)}>
                <ThumbsUp className="size-3.5" />
                有用
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void onFeedback(log, 0)}>
                <ThumbsDown className="size-3.5" />
                无用
              </Button>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

function deliveryStateLabel(status: string) {
  switch (status) {
    case "anchored":
      return "已建立消息锚点"
    case "context_ready":
      return "上下文已建立"
    case "waiting_for_contact_message":
      return "等待联系人先发消息"
    default:
      return "待初始化"
  }
}

function formatTime(isoString: string) {
  const date = new Date(isoString)
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}
