"use client"

import type { ReactNode } from "react"
import { useState } from "react"
import {
  Activity,
  Link2,
  MousePointerClick,
  Sparkles,
} from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { Button } from "@/ui/shadcn/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/ui/shadcn/card"
import { useI18n } from "@/hooks/use-i18n"
import {
  useBrowserModeStatus,
  type BrowserModeConnectionState,
} from "@/hooks/chat/use-browser-mode-status"
import { getLocalBrowserAgentPageSnapshot } from "@/lib/api/browser-agent"
import { buildPageInspectionResult } from "@/lib/browser/page-inspection"
import { cn } from "@/lib/utils"
import { useBrowserModeStore } from "@/store/browser-mode-store"
import { useWorkspaceStore } from "@/store/workspace-store"

interface BrowserModePanelProps {
  viewId: string
  title: string
}

const BROWSER_AGENT_BRIDGE_START_FAILED_PREFIX =
  "browser_agent_bridge_start_failed:"

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

function getConnectionStateTranslationKey(
  connectionState: BrowserModeConnectionState
) {
  return `browserMode.panel.connectionState.${connectionState}` as const
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

function resolveConnectionDetail(
  statusDetail: string | null,
  connectionState: BrowserModeConnectionState,
  t: ReturnType<typeof useI18n>
) {
  if (!statusDetail) {
    if (connectionState === "idle") {
      return t("browserMode.panel.connectionUnknown")
    }

    return t(getConnectionStateTranslationKey(connectionState))
  }

  switch (statusDetail) {
    case "browser_agent_extension_connected":
      return t("browserMode.panel.connectionDetail.browser_agent_extension_connected")
    case "browser_agent_bridge_listening":
      return t("browserMode.panel.connectionDetail.browser_agent_bridge_listening")
    case "browser_agent_desktop_only":
      return t("browserMode.panel.connectionDetail.browser_agent_desktop_only")
    default:
      if (statusDetail.startsWith(BROWSER_AGENT_BRIDGE_START_FAILED_PREFIX)) {
        const detail = statusDetail
          .slice(BROWSER_AGENT_BRIDGE_START_FAILED_PREFIX.length)
          .trim()

        return t("browserMode.panel.connectionDetail.browser_agent_bridge_start_failed", {
          detail: detail || statusDetail,
        })
      }

      return statusDetail
  }
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
    t(getConnectionStateTranslationKey(connectionState))

  const resolvedStatusDetail = resolveConnectionDetail(
    statusDetail,
    connectionState,
    t
  )
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
          <div className="grid gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusChip className="w-fit border-primary/20 bg-primary/6 text-primary">
                    <Sparkles className="h-3.5 w-3.5" />
                    {title}
                  </StatusChip>
                  <StatusChip className={getExecutionToneClass(executionPhase)}>
                    {resolvedExecutionLabel}
                  </StatusChip>
                  {page?.host ? <StatusChip>{page.host}</StatusChip> : null}
                </div>
                <div className="space-y-2">
                  <CardTitle className="text-xl font-semibold tracking-tight">
                    {resolvedExecutionLabel}
                  </CardTitle>
                  <CardDescription className="max-w-[40ch] text-sm leading-6 text-muted-foreground/90">
                    {t("browserMode.panel.description")}
                  </CardDescription>
                </div>
              </div>
              <div className="grid min-w-[132px] gap-2 rounded-[1.1rem] border border-border/60 bg-background/80 p-2.5 shadow-[0_1px_0_rgba(255,255,255,0.05)_inset]">
                <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  {t("browserMode.panel.connectionLabel")}
                </span>
                <span className="text-sm font-semibold leading-5 text-foreground">
                  {resolvedConnectionLabel}
                </span>
                <span className="text-xs leading-5 text-muted-foreground">
                  {resolvedStatusDetail}
                </span>
              </div>
            </div>

            <div className="grid gap-3 rounded-[1.25rem] border border-border/60 bg-background/75 p-4 shadow-[0_1px_0_rgba(255,255,255,0.04)_inset]">
              {requestPrompt ? (
                <div className="grid gap-1.5">
                  <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                    {t("browserMode.panel.requestLabel")}
                  </span>
                  <span className="line-clamp-3 text-sm leading-6 text-foreground">
                    {requestPrompt}
                  </span>
                </div>
              ) : null}

              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-[1rem] border border-border/50 bg-muted/[0.12] px-3.5 py-3">
                  <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                    {t("browserMode.panel.executionLabel")}
                  </span>
                  <div className="mt-1.5 grid gap-1">
                    <span className="text-sm font-semibold leading-6 text-foreground">
                      {resolvedExecutionLabel}
                    </span>
                    {executionLabel ? (
                      <span className="text-xs leading-5 text-muted-foreground">
                        {executionLabel}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="rounded-[1rem] border border-border/50 bg-muted/[0.12] px-3.5 py-3">
                  <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                    {t("browserMode.panel.pageLabel")}
                  </span>
                  <div className="mt-1.5 grid gap-1">
                    <span className="truncate text-sm font-semibold leading-6 text-foreground">
                      {page?.title ?? t("browserMode.panel.pageEmpty")}
                    </span>
                    <span className="truncate text-xs leading-5 text-muted-foreground">
                      {page?.url ?? page?.host ?? t("browserMode.panel.pageEmpty")}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-10 rounded-2xl border-border/60 bg-background/80 shadow-none hover:bg-muted/60"
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
              className="h-10 rounded-2xl border-border/60 bg-background/80 shadow-none hover:bg-muted/60"
              onClick={() => pause(t("browserMode.panel.pausedStatus"))}
              aria-label={t("browserMode.panel.pause")}
            >
              {t("browserMode.panel.pause")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-10 rounded-2xl border-border/60 bg-background/80 shadow-none hover:bg-muted/60"
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
              className="h-10 rounded-2xl shadow-none"
              onClick={handleEnd}
              aria-label={endLabel}
            >
              {endLabel}
            </Button>
            </div>
          </div>
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
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
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
                  <MetricStack
                    icon={<MousePointerClick className="h-3.5 w-3.5" />}
                    label={t("browserMode.panel.lastActionLabel")}
                    primary={
                      lastAction?.summary ?? t("browserMode.panel.lastActionEmpty")
                    }
                  />
                </div>
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
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
