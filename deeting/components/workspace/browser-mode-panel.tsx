"use client"

import type { ReactNode } from "react"
import { useState } from "react"
import {
  Activity,
  ExternalLink,
  Globe,
  Link2,
  MousePointerClick,
  Sparkles,
} from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { useI18n } from "@/hooks/use-i18n"
import { useBrowserModeStatus } from "@/hooks/chat/use-browser-mode-status"
import { getLocalBrowserAgentPageSnapshot } from "@/lib/api/browser-agent"
import { buildPageInspectionResult } from "@/lib/browser/page-inspection"
import { cn } from "@/lib/utils"
import { useBrowserModeStore } from "@/store/browser-mode-store"
import { useWorkspaceStore } from "@/store/workspace-store"

interface BrowserModePanelProps {
  viewId: string
  title: string
}

function getExecutionToneClass(phase: string) {
  switch (phase) {
    case "waiting":
      return "border-sky-500/25 bg-sky-500/8 text-sky-700 dark:text-sky-300"
    case "verifying":
      return "border-emerald-500/25 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300"
    case "recovering":
      return "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300"
    case "paused":
      return "border-orange-500/25 bg-orange-500/8 text-orange-700 dark:text-orange-300"
    case "ended":
      return "border-zinc-500/25 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300"
    default:
      return "border-primary/20 bg-primary/8 text-primary"
  }
}

function StatusChip({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-border/70 bg-background/80 px-2.5 py-1 text-[11px] font-medium text-muted-foreground",
        className
      )}
    >
      {children}
    </span>
  )
}

function InspectorSection({
  label,
  children,
  className,
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        "grid gap-3 rounded-[1.25rem] border border-border/60 bg-background/70 p-4 shadow-[0_1px_0_rgba(255,255,255,0.04)_inset]",
        className
      )}
    >
      <span className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground/90">
        {label}
      </span>
      {children}
    </section>
  )
}

function MetricStack({
  icon,
  label,
  primary,
  secondary,
  detail,
  className,
}: {
  icon: ReactNode
  label: string
  primary: ReactNode
  secondary?: ReactNode
  detail?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "grid gap-2 rounded-2xl border border-border/50 bg-muted/[0.12] p-3.5",
        className
      )}
    >
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        <span className="flex h-7 w-7 items-center justify-center rounded-full border border-border/60 bg-background/80 text-foreground/70">
          {icon}
        </span>
        <span>{label}</span>
      </div>
      <div className="grid gap-1.5">
        <span className="text-sm font-medium leading-6 text-foreground">{primary}</span>
        {secondary ? (
          <span className="text-xs font-medium leading-5 text-muted-foreground">
            {secondary}
          </span>
        ) : null}
        {detail ? <div className="text-xs leading-5 text-muted-foreground">{detail}</div> : null}
      </div>
    </div>
  )
}

function TimelineEntry({
  children,
  phase,
  label,
  className,
}: {
  phase: string
  label: string
  children?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "relative pl-6",
        className
      )}
    >
      <span
        className={cn(
          "absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-background",
          phase === "browserMode.panel.execution.waiting" &&
            "bg-sky-500 shadow-[0_0_0_1px_rgba(14,165,233,0.15)]",
          phase === "browserMode.panel.execution.verifying" &&
            "bg-emerald-500 shadow-[0_0_0_1px_rgba(16,185,129,0.15)]",
          phase === "browserMode.panel.execution.recovering" &&
            "bg-amber-500 shadow-[0_0_0_1px_rgba(245,158,11,0.18)]",
          phase !== "browserMode.panel.execution.waiting" &&
            phase !== "browserMode.panel.execution.verifying" &&
            phase !== "browserMode.panel.execution.recovering" &&
            "bg-foreground/75"
        )}
      />
      <div className="grid gap-2 border-l border-border/60 pl-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <span className="text-sm leading-6 text-foreground">{label}</span>
          <StatusChip
            className={cn(
              "shrink-0 text-[10px] uppercase tracking-wide",
              getExecutionToneClass(
                phase.replace("browserMode.panel.execution.", "")
              )
            )}
          >
            {phase}
          </StatusChip>
        </div>
        {children}
      </div>
    </div>
  )
}

export function BrowserModePanel({ viewId, title }: BrowserModePanelProps) {
  const t = useI18n("chat")
  const { closeView, openView } = useWorkspaceStore(
    useShallow((state) => ({
      closeView: state.closeView,
      openView: state.openView,
    }))
  )
  const [isInspecting, setIsInspecting] = useState(false)
  const {
    status,
    executionPhase,
    executionLabel,
    retryCount,
    recoveryReason,
    request,
    connectionLabel,
    page,
    lastAction,
    timeline,
    pause,
    reconnect,
    end,
  } = useBrowserModeStore(
    useShallow((state) => ({
      status: state.status,
      executionPhase: state.executionPhase,
      executionLabel: state.executionLabel,
      retryCount: state.retryCount,
      recoveryReason: state.recoveryReason,
      request: state.request,
      connectionLabel: state.connectionLabel,
      page: state.page,
      lastAction: state.lastAction,
      timeline: state.timeline,
      pause: state.pause,
      reconnect: state.reconnect,
      end: state.end,
    }))
  )
  const { connectionState, statusDetail, isRefreshing, refresh } =
    useBrowserModeStatus(true)

  const resolvedConnectionLabel =
    connectionLabel ??
    t(`browserMode.panel.status.${connectionState}`)

  const resolvedStatusDetail =
    statusDetail ?? t(`browserMode.panel.status.${connectionState}`)
  const isRecovering =
    status === "recovering" ||
    connectionState === "extension_not_connected" ||
    connectionState === "error"
  const reconnectLabel = isRecovering
    ? t("browserMode.panel.reconnectContinue")
    : t("browserMode.panel.reconnect")
  const endLabel = isRecovering
    ? t("browserMode.panel.endTask")
    : t("browserMode.panel.end")
  const resolvedExecutionLabel = t(`browserMode.panel.execution.${executionPhase}`)
  const requestPrompt = request?.prompt ?? null

  const handleEnd = () => {
    end(t("browserMode.panel.endedSummary"))
    closeView(viewId)
  }

  const handleReconnect = () => {
    reconnect(t("browserMode.panel.reconnectingStatus"))
    void refresh()
  }

  const handleInspectPage = async () => {
    if (!page?.tabId) return

    setIsInspecting(true)
    try {
      const snapshot = await getLocalBrowserAgentPageSnapshot(page.tabId)
      const result = buildPageInspectionResult(snapshot)
      openView({
        id: `browser-inspection-${page.tabId}`,
        type: "native-canvas",
        title: t("inspection.title"),
        content: {
          viewType: "page-inspection",
          result,
        },
      })
    } finally {
      setIsInspecting(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 w-full p-3 md:p-4">
      <Card className="flex h-full min-h-0 w-full flex-col overflow-hidden border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0))] py-0 shadow-[0_12px_40px_rgba(0,0,0,0.12)] backdrop-blur-sm">
        <CardHeader className="shrink-0 gap-4 border-b border-border/70 bg-[linear-gradient(180deg,rgba(120,140,180,0.08),rgba(120,140,180,0.01))] px-4 py-4 md:px-5 md:py-4.5">
          <div className="space-y-3">
            <div className="space-y-3">
              <StatusChip className="w-fit border-primary/20 bg-primary/6 text-primary">
                <Sparkles className="h-3.5 w-3.5" />
                {title}
              </StatusChip>
              <div className="space-y-2">
                <CardTitle className="text-xl font-semibold tracking-tight">
                  {resolvedExecutionLabel}
                </CardTitle>
                <CardDescription className="max-w-[34ch] text-sm leading-6 text-muted-foreground/90">
                  {t("browserMode.panel.description")}
                </CardDescription>
              </div>
            </div>

            <div className="grid gap-2.5 rounded-[1.25rem] border border-border/60 bg-background/75 p-3.5 shadow-[0_1px_0_rgba(255,255,255,0.04)_inset]">
              <div className="flex flex-wrap gap-2">
                <StatusChip>{resolvedConnectionLabel}</StatusChip>
                <StatusChip className={getExecutionToneClass(executionPhase)}>
                  {resolvedExecutionLabel}
                </StatusChip>
                {page?.host ? <StatusChip>{page.host}</StatusChip> : null}
              </div>
              {requestPrompt ? (
                <div className="grid gap-1">
                  <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                    {t("browserMode.panel.requestLabel")}
                  </span>
                  <span className="line-clamp-3 text-sm leading-6 text-foreground">
                    {requestPrompt}
                  </span>
                </div>
              ) : null}
            </div>
          </div>
          <CardAction className="col-start-1 row-start-2 mt-1 max-w-full justify-self-start sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:mt-0 sm:justify-self-end">
            <div className="flex flex-wrap items-center gap-2 rounded-full border border-border/60 bg-background/80 p-1.5 shadow-[0_1px_0_rgba(255,255,255,0.05)_inset]">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-full border-transparent bg-transparent shadow-none hover:border-border/60 hover:bg-muted/60"
              onClick={() => void handleInspectPage()}
              aria-label={t("browserMode.panel.inspect")}
              disabled={!page?.tabId || isInspecting}
            >
              {t("browserMode.panel.inspect")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-full border-transparent bg-transparent shadow-none hover:border-border/60 hover:bg-muted/60"
              onClick={() => pause(t("browserMode.panel.pausedStatus"))}
              aria-label={t("browserMode.panel.pause")}
            >
              {t("browserMode.panel.pause")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-full border-transparent bg-transparent shadow-none hover:border-border/60 hover:bg-muted/60"
              onClick={handleReconnect}
              aria-label={reconnectLabel}
              disabled={isRefreshing}
            >
              {reconnectLabel}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="rounded-full shadow-none"
              onClick={handleEnd}
              aria-label={endLabel}
            >
              {endLabel}
            </Button>
            </div>
          </CardAction>
        </CardHeader>
        <CardContent
          data-testid="browser-mode-panel-scroll-body"
          className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-5 md:py-4"
        >
          <div className="grid gap-3.5">
            {isRecovering ? (
              <section className="grid gap-2 rounded-[1.25rem] border border-amber-300/60 bg-amber-50/80 p-4 dark:border-amber-400/20 dark:bg-amber-500/10">
                <span className="text-[11px] uppercase tracking-[0.2em] text-amber-800/80 dark:text-amber-100/75">
                  {t("browserMode.panel.executionLabel")}
                </span>
                <span className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                  {t("browserMode.panel.recoveryTitle")}
                </span>
                <span className="text-xs leading-5 text-amber-800/85 dark:text-amber-100/75">
                  {t("browserMode.panel.recoveryDescription")}
                </span>
              </section>
            ) : null}

            <InspectorSection label={t("browserMode.panel.executionLabel")}>
              <div className="grid gap-3">
                <MetricStack
                  icon={<Link2 className="h-3.5 w-3.5" />}
                  label={t("browserMode.panel.connectionLabel")}
                  primary={resolvedConnectionLabel}
                  detail={resolvedStatusDetail}
                />
                <MetricStack
                  icon={<Globe className="h-3.5 w-3.5" />}
                  label={t("browserMode.panel.pageLabel")}
                  primary={page?.title ?? t("browserMode.panel.pageEmpty")}
                  secondary={page?.host}
                  detail={
                    page?.url ? (
                      <span className="block truncate">{page.url}</span>
                    ) : null
                  }
                />
                <MetricStack
                  icon={<MousePointerClick className="h-3.5 w-3.5" />}
                  label={t("browserMode.panel.lastActionLabel")}
                  primary={lastAction?.summary ?? t("browserMode.panel.lastActionEmpty")}
                />
                <MetricStack
                  icon={<Activity className="h-3.5 w-3.5" />}
                  label={t("browserMode.panel.executionLabel")}
                  primary={resolvedExecutionLabel}
                  detail={
                    <span className="grid gap-1">
                      {executionLabel ? <span>{executionLabel}</span> : null}
                      {retryCount > 0 ? (
                        <span>{t("browserMode.panel.retryCount", { count: retryCount })}</span>
                      ) : null}
                      {recoveryReason ? <span>{recoveryReason}</span> : null}
                    </span>
                  }
                />
              </div>
            </InspectorSection>

            {timeline.length > 0 ? (
              <InspectorSection
                label={t("browserMode.panel.timelineLabel")}
                className="gap-4"
              >
                <div className="grid gap-1">
                  {timeline.map((entry) => (
                    <TimelineEntry
                      key={entry.id}
                      label={entry.label}
                      phase={t(`browserMode.panel.execution.${entry.phase}`)}
                    >
                      {entry.phase === executionPhase && executionLabel ? (
                        <span className="text-xs leading-5 text-muted-foreground">
                          {executionLabel}
                        </span>
                      ) : null}
                    </TimelineEntry>
                  ))}
                </div>
              </InspectorSection>
            ) : null}

            {page?.url ? (
              <InspectorSection label={t("browserMode.panel.pageLabel")} className="gap-3">
                <div className="flex items-start gap-3 rounded-[1.15rem] border border-border/50 bg-muted/[0.12] p-3.5">
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border/60 bg-background/80 text-foreground/70">
                    <ExternalLink className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 grid gap-1.5">
                    <span className="text-sm font-medium leading-6 text-foreground">
                      {page?.title ?? t("browserMode.panel.pageEmpty")}
                    </span>
                    {page?.host ? (
                      <span className="text-xs font-medium text-muted-foreground">
                        {page.host}
                      </span>
                    ) : null}
                    <span className="truncate text-xs leading-5 text-muted-foreground">
                      {page.url}
                    </span>
                  </div>
                </div>
              </InspectorSection>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
