"use client"

import { useCallback, useMemo } from "react"
import { useLocale, useTranslations } from "next-intl"
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

export function MonitorExecutionLog({ taskId, onClose }: MonitorExecutionLogProps) {
  const t = useTranslations("monitoring")
  const locale = useLocale()
  const { data: logs, isLoading, mutate } = useMonitorLogs(taskId)
  const { data: deliveryStates } = useMonitorDeliveryStates(taskId)
  const statusMeta = useMemo(
    () => ({
      success: { label: t("monitors.log.status.success"), icon: CheckCircle2, className: "text-emerald-600" },
      failure: { label: t("monitors.log.status.failure"), icon: XCircle, className: "text-red-600" },
      skipped: { label: t("monitors.log.status.skipped"), icon: MinusCircle, className: "text-amber-600" },
    }),
    [t],
  )

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
          <SheetTitle>{t("monitors.log.title")}</SheetTitle>
          <SheetDescription>
            {t("monitors.log.description")}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          {deliveryStates?.items?.length ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("monitors.log.deliveryTitle")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {deliveryStates.items.map((item) => (
                  <DeliveryStateRow
                    key={`${item.channel_id}-${item.target_key}`}
                    item={item}
                    locale={locale}
                    t={t}
                  />
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
            logs.items.map((log) => (
              <LogCard
                key={log.id}
                log={log}
                onFeedback={handleFeedback}
                locale={locale}
                t={t}
                statusMeta={statusMeta}
              />
            ))
          ) : (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center gap-3 py-12 text-center text-sm text-muted-foreground">
                <Clock3 className="size-8" />
                <div>{t("monitors.log.empty")}</div>
              </CardContent>
            </Card>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function DeliveryStateRow({
  item,
  locale,
  t,
}: {
  item: MonitorDeliveryStateRecord
  locale: string
  t: ReturnType<typeof useTranslations>
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-sm">
      <div className="flex items-center gap-2">
        <Badge variant="secondary">{item.channel_kind || t("monitors.log.channelFallback")}</Badge>
        <span className="font-medium">{item.channel_display_name || item.target_key}</span>
        <span className="ml-auto text-xs text-muted-foreground">{deliveryStateLabel(item.status, t)}</span>
      </div>
      <div className="mt-2 text-xs text-muted-foreground">{item.target_key}</div>
      {item.updated_at ? (
        <div className="mt-1 text-[11px] text-muted-foreground/80">
          {formatTime(item.updated_at, locale)}
        </div>
      ) : null}
    </div>
  )
}

function LogCard({
  log,
  onFeedback,
  locale,
  t,
  statusMeta,
}: {
  log: MonitorExecutionLogItem
  onFeedback: (log: MonitorExecutionLogItem, score: number) => Promise<void>
  locale: string
  t: ReturnType<typeof useTranslations>
  statusMeta: {
    success: { label: string; icon: typeof CheckCircle2; className: string }
    failure: { label: string; icon: typeof XCircle; className: string }
    skipped: { label: string; icon: typeof MinusCircle; className: string }
  }
}) {
  const meta = statusMeta[log.status]
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
              {t("monitors.log.significantChange")}
            </Badge>
          ) : null}
          <span className="ml-auto text-xs text-muted-foreground">{formatTime(log.triggered_at, locale)}</span>
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
            {t("monitors.log.tokensUsed", { count: log.tokens_used })}
          </span>
          {log.status === "success" ? (
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => void onFeedback(log, 1)}>
                <ThumbsUp className="size-3.5" />
                {t("monitors.log.feedback.useful")}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void onFeedback(log, 0)}>
                <ThumbsDown className="size-3.5" />
                {t("monitors.log.feedback.notUseful")}
              </Button>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

function deliveryStateLabel(
  status: string,
  t: ReturnType<typeof useTranslations>,
) {
  switch (status) {
    case "anchored":
      return t("monitors.log.deliveryStatus.anchored")
    case "context_ready":
      return t("monitors.log.deliveryStatus.contextReady")
    case "waiting_for_contact_message":
      return t("monitors.log.deliveryStatus.waitingForContact")
    default:
      return t("monitors.log.deliveryStatus.pending")
  }
}

function formatTime(isoString: string, locale: string) {
  const date = new Date(isoString)
  return date.toLocaleString(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}
