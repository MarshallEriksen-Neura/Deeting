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
  type MonitorRunEvent,
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
  const timeline = buildTimeline(events, t)

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
        <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
          <div className="text-xs font-medium text-muted-foreground">
            {t("monitors.log.outcomeTitle")}
          </div>
          {changeSummary ? (
            <div className="mt-2 whitespace-pre-wrap leading-6 text-foreground">
              {changeSummary}
            </div>
          ) : log.error_message ? (
            <div className="mt-2 leading-6 text-red-700 dark:text-red-300">
              {log.error_message}
            </div>
          ) : (
            <div className="mt-2 text-muted-foreground">
              {t("monitors.log.noSummary")}
            </div>
          )}
        </div>

        {timeline.length ? (
          <div className="space-y-3">
            <div className="text-xs font-medium text-muted-foreground">
              {t("monitors.log.timelineTitle")}
            </div>
            <div className="space-y-0 border-l border-border/70 pl-4">
              {timeline.map((entry) => (
                <div key={entry.key} className="relative pb-4 last:pb-0">
                  <span className={`absolute -left-[21px] top-1 size-2.5 rounded-full border-2 border-background ${statusDotClass(entry.status)}`} />
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      {entry.phaseLabel}
                    </span>
                    <Badge variant="outline" className="h-5 rounded-md px-1.5 text-[10px]">
                      {statusLabel(entry.status, t)}
                    </Badge>
                  </div>
                  <div className="mt-1 font-medium leading-5 text-foreground">
                    {entry.title}
                  </div>
                  {entry.detail ? (
                    <div className="mt-1 text-xs leading-5 text-muted-foreground">
                      {entry.detail}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {events.length ? (
          <details className="rounded-xl border border-border/60 bg-muted/10 px-3 py-2 text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none font-medium text-foreground/80">
              {t("monitors.log.diagnosticsTitle", { count: events.length })}
            </summary>
            <div className="mt-3 max-h-72 space-y-3 overflow-auto">
              {events.map((event) => (
                <div key={event.event_id} className="rounded-lg bg-background/70 p-3">
                  <div className="font-medium text-foreground/80">
                    {eventDiagnosticTitle(event)}
                  </div>
                  <div className="mt-1">
                    {[
                      event.kind,
                      event.stage,
                      event.step,
                      event.state,
                    ].filter(Boolean).join(" / ")}
                  </div>
                  {event.meta ? (
                    <pre className="mt-2 whitespace-pre-wrap break-words text-[11px] leading-5">
                      {JSON.stringify(event.meta, null, 2)}
                    </pre>
                  ) : null}
                </div>
              ))}
            </div>
          </details>
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

type TimelineStatus = "running" | "success" | "failed" | "neutral"
type TimelinePhase = "prepare" | "context" | "execute" | "analyze" | "delivery" | "complete"

interface TimelineEntry {
  key: string
  phaseLabel: string
  title: string
  detail?: string
  status: TimelineStatus
}

function buildTimeline(
  events: MonitorRunEvent[],
  t: ReturnType<typeof useTranslations>,
): TimelineEntry[] {
  const codes = new Set(events.map(eventCode).filter((code): code is string => Boolean(code)))
  return events
    .filter((event) => shouldShowTimelineEvent(event, codes))
    .map((event) => timelineEntry(event, t))
    .filter((entry): entry is TimelineEntry => Boolean(entry))
    .slice(0, 10)
}

function shouldShowTimelineEvent(event: MonitorRunEvent, codes: Set<string>) {
  const code = eventCode(event)
  if (code === "monitor.agent.resolving" && codes.has("monitor.agent.resolved")) return false
  if (code === "monitor.prompt.building" && codes.has("monitor.prompt.built")) return false
  if (
    code === "monitor.agent.executing" &&
    (codes.has("monitor.response.received") || codes.has("monitor.agent.error"))
  ) {
    return false
  }
  if (event.kind === "tool_called") return false
  return true
}

function timelineEntry(
  event: MonitorRunEvent,
  t: ReturnType<typeof useTranslations>,
): TimelineEntry | null {
  const code = eventCode(event)
  const details = eventDetails(event)
  const phase = eventPhase(event, code)
  const title = eventTitle(event, code, details, t)
  if (!title) return null

  return {
    key: event.event_id || `${event.seq}-${event.kind}-${code || event.step || ""}`,
    phaseLabel: t(`monitors.log.phases.${phase}`),
    title,
    detail: eventDetail(event, code, details, t),
    status: eventStatus(event),
  }
}

function eventPhase(event: MonitorRunEvent, code: string | undefined): TimelinePhase {
  if (event.kind === "run_completed" || event.kind === "run_failed") return "complete"
  if (event.kind === "delivery_failed") return "delivery"
  if (event.kind === "tool_succeeded" || event.kind === "tool_failed") return "execute"
  if (code?.startsWith("monitor.agent.")) return "prepare"
  if (code?.startsWith("monitor.prompt.")) return "context"
  if (code?.startsWith("monitor.response.")) return "execute"
  if (code?.startsWith("monitor.analysis.") || event.step === "monitor_policy_result") return "analyze"
  return "execute"
}

function eventStatus(event: MonitorRunEvent): TimelineStatus {
  if (event.kind === "run_failed" || event.kind === "delivery_failed" || event.kind === "tool_failed") {
    return "failed"
  }
  if (event.kind === "run_completed" || event.kind === "tool_succeeded") return "success"
  if (event.state === "failed") return "failed"
  if (event.state === "running") return "running"
  if (event.state === "success") return "success"
  return "neutral"
}

function eventTitle(
  event: MonitorRunEvent,
  code: string | undefined,
  details: Record<string, unknown> | undefined,
  t: ReturnType<typeof useTranslations>,
) {
  switch (code) {
    case "monitor.agent.resolving":
      return t("monitors.log.events.agentResolving")
    case "monitor.agent.resolved": {
      const name = stringValue(details?.assistant_name)
      return name
        ? t("monitors.log.events.agentResolvedWithName", { name })
        : t("monitors.log.events.agentResolved")
    }
    case "monitor.prompt.building":
      return t("monitors.log.events.promptBuilding")
    case "monitor.prompt.built":
      return t("monitors.log.events.promptBuilt")
    case "monitor.agent.executing":
      return t("monitors.log.events.agentExecuting")
    case "monitor.agent.error":
      return t("monitors.log.events.agentError")
    case "monitor.response.empty":
      return t("monitors.log.events.responseEmpty")
    case "monitor.response.received":
      return t("monitors.log.events.responseReceived")
    case "monitor.analysis.done":
      return t("monitors.log.events.analysisDone")
    default:
      break
  }
  if (event.step === "monitor_policy_result") {
    return t("monitors.log.events.policyResult")
  }

  switch (event.kind) {
    case "run_started":
      return t("monitors.log.events.runStarted")
    case "run_completed":
      return t("monitors.log.events.runCompleted")
    case "run_failed":
      return t("monitors.log.events.runFailed")
    case "delivery_failed":
      return t("monitors.log.events.deliveryFailed")
    case "tool_succeeded": {
      const tool = stringValue(details?.tool_name) || event.step || t("monitors.log.events.toolFallback")
      return t("monitors.log.events.toolSucceeded", { tool })
    }
    case "tool_failed": {
      const tool = stringValue(details?.tool_name) || event.step || t("monitors.log.events.toolFallback")
      return t("monitors.log.events.toolFailed", { tool })
    }
    default:
      return event.summary || event.step || event.kind
  }
}

function eventDetail(
  event: MonitorRunEvent,
  code: string | undefined,
  details: Record<string, unknown> | undefined,
  t: ReturnType<typeof useTranslations>,
): string | undefined {
  if (code === "monitor.response.received") {
    const model = stringValue(details?.model_id)
    const tokens = numberValue(details?.tokens_used)
    const tools = numberValue(details?.tool_trace_len)
    return t("monitors.log.details.responseReceived", {
      model: model || t("monitors.log.details.unknownModel"),
      tokens,
      tools,
    })
  }
  if (code === "monitor.analysis.done") {
    return booleanValue(details?.is_significant_change)
      ? t("monitors.log.details.significant")
      : t("monitors.log.details.notSignificant")
  }
  if (code === "monitor.agent.error") {
    return stringValue(details?.message)
  }
  if (event.kind === "tool_failed") {
    return stringValue(details?.error)
  }
  if (event.kind === "delivery_failed") {
    return stringValue(details?.error) || event.summary || undefined
  }
  if (event.kind === "run_failed") {
    return event.summary || undefined
  }
  return undefined
}

function statusLabel(status: TimelineStatus, t: ReturnType<typeof useTranslations>) {
  return t(`monitors.log.timelineStatus.${status}`)
}

function statusDotClass(status: TimelineStatus) {
  switch (status) {
    case "running":
      return "bg-sky-500"
    case "success":
      return "bg-emerald-500"
    case "failed":
      return "bg-red-500"
    default:
      return "bg-muted-foreground"
  }
}

function eventDiagnosticTitle(event: MonitorRunEvent) {
  return eventCode(event) || event.step || event.summary || event.kind
}

function eventCode(event: MonitorRunEvent) {
  const meta = event.meta
  if (!isRecord(meta)) return undefined
  return stringValue(meta.code)
}

function eventDetails(event: MonitorRunEvent) {
  const meta = event.meta
  if (!isRecord(meta)) return undefined
  return isRecord(meta.details) ? meta.details : meta
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function booleanValue(value: unknown) {
  return typeof value === "boolean" ? value : false
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
