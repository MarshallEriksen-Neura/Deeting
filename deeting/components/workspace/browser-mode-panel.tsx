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
        "inline-flex items-center rounded-[4px] border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider",
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
        "grid gap-4 py-4 border-b border-border/40",
        className
      )}
    >
      <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground/70">
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
        "grid gap-1.5 border-l border-border/40 pl-3.5",
        className
      )}
    >
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 font-mono">
        <span className="text-foreground/50">
          {icon}
        </span>
        <span>{label}</span>
      </div>
      <div className="grid gap-1">
        <span className="text-xs font-medium leading-5 text-foreground truncate">{primary}</span>
        {secondary ? (
          <span className="text-[10px] leading-4 text-muted-foreground">
            {secondary}
          </span>
        ) : null}
        {detail ? <div className="text-[10px] leading-relaxed text-muted-foreground/80 font-mono mt-1">{detail}</div> : null}
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
  const isRunning = phase.includes("waiting") || phase.includes("recovering") || phase.includes("verifying");

  return (
    <div className={cn("relative flex gap-4 pb-5 last:pb-0", className)}>
      <div className="flex flex-col items-center">
        <div className="relative">
          <div
            className={cn(
              "flex h-3.5 w-3.5 items-center justify-center rounded-full border bg-transparent transition-colors",
              isRunning ? "border-emerald-400 bg-emerald-400/20" : "border-emerald-500 bg-emerald-500/20"
            )}
          />
          {isRunning && (
            <div className="absolute inset-0 rounded-full border border-emerald-400 animate-ping opacity-60" />
          )}
        </div>
        <div className="mt-1 w-px flex-1 bg-border/50" />
      </div>

      <div className="min-w-0 flex-1 pb-1 pt-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="truncate text-[13px] font-medium tracking-wide text-foreground">
              {label}
            </span>
            <StatusChip
              className={cn(
                "shrink-0",
                getExecutionToneClass(
                  phase.replace("browserMode.panel.execution.", "")
                )
              )}
            >
              {phase}
            </StatusChip>
          </div>
        </div>
        {children && <div className="mt-1.5 text-[12px] leading-5 text-muted-foreground/60">{children}</div>}
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
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-transparent">
      <div className="shrink-0 border-b border-border/50 px-5 py-4">
        <div className="grid gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip className="w-fit border-primary/20 bg-primary/6 text-primary">
                  <Sparkles className="h-3 w-3 mr-1" />
                  {title}
                </StatusChip>
                <StatusChip className={getExecutionToneClass(executionPhase)}>
                  {resolvedExecutionLabel}
                </StatusChip>
                {page?.host ? <StatusChip>{page.host}</StatusChip> : null}
              </div>
              <div className="space-y-1">
                <h2 className="text-lg font-semibold tracking-tight">
                  {resolvedExecutionLabel}
                </h2>
                <p className="max-w-[40ch] text-[13px] leading-relaxed text-muted-foreground/80">
                  {t("browserMode.panel.description")}
                </p>
              </div>
            </div>
            <div className="grid min-w-[140px] gap-1.5 border-l border-border/40 pl-4 py-1">
              <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground/70">
                {t("browserMode.panel.connectionLabel")}
              </span>
              <span className="text-sm font-medium leading-5 text-foreground">
                {resolvedConnectionLabel}
              </span>
              <span className="text-[10px] leading-4 text-muted-foreground font-mono">
                {resolvedStatusDetail}
              </span>
            </div>
          </div>

          <div className="grid gap-3 py-2 border-t border-border/40 mt-1">
            {requestPrompt ? (
              <div className="grid gap-1.5 border-l border-border/40 pl-3">
                <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground/70">
                  {t("browserMode.panel.requestLabel")}
                </span>
                <span className="line-clamp-3 text-[13px] leading-6 text-foreground">
                  {requestPrompt}
                </span>
              </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2 mt-2">
              <div className="border-l border-border/40 pl-3">
                <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground/70">
                  {t("browserMode.panel.executionLabel")}
                </span>
                <div className="mt-1 grid gap-0.5">
                  <span className="text-sm font-medium leading-6 text-foreground">
                    {resolvedExecutionLabel}
                  </span>
                  {executionLabel ? (
                    <span className="text-[11px] leading-5 text-muted-foreground font-mono">
                      {executionLabel}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="border-l border-border/40 pl-3">
                <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground/70">
                  {t("browserMode.panel.pageLabel")}
                </span>
                <div className="mt-1 grid gap-0.5">
                  <span className="truncate text-sm font-medium leading-6 text-foreground">
                    {page?.title ?? t("browserMode.panel.pageEmpty")}
                  </span>
                  <span className="truncate text-[11px] leading-5 text-muted-foreground font-mono">
                    {page?.url ?? page?.host ?? t("browserMode.panel.pageEmpty")}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-2 border-t border-border/40">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 rounded-[6px] px-3 font-mono text-[11px] border border-border/40 hover:bg-muted/50"
              onClick={() => void handleInspectPage()}
              aria-label={t("browserMode.panel.inspect")}
              disabled={!page?.tabId || isInspecting}
            >
              {'>'} {t("browserMode.panel.inspect")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 rounded-[6px] px-3 font-mono text-[11px] border border-border/40 hover:bg-muted/50"
              onClick={() => pause(t("browserMode.panel.pausedStatus"))}
              aria-label={t("browserMode.panel.pause")}
            >
              {'>'} {t("browserMode.panel.pause")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 rounded-[6px] px-3 font-mono text-[11px] border border-border/40 hover:bg-muted/50"
              onClick={handleReconnect}
              aria-label={reconnectLabel}
              disabled={isRefreshing}
            >
              {'>'} {reconnectLabel}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 rounded-[6px] px-3 font-mono text-[11px] border border-rose-500/40 text-rose-500 hover:bg-rose-500/10 hover:text-rose-600"
              onClick={handleEnd}
              aria-label={endLabel}
            >
              [X] {endLabel}
            </Button>
          </div>
        </div>
      </div>
      
      <div
        data-testid="browser-mode-panel-scroll-body"
        className="min-h-0 flex-1 overflow-y-auto px-5 py-2"
      >
          <div className="grid gap-3.5">
            {isRecovering ? (
              <section className="grid gap-2 border-l-2 border-amber-500/40 bg-amber-500/5 py-3 pl-4 pr-2 mb-4">
                <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-amber-600 dark:text-amber-400">
                  {t("browserMode.panel.executionLabel")}
                </span>
                <span className="text-[13px] font-medium text-amber-700 dark:text-amber-300">
                  {t("browserMode.panel.recoveryTitle")}
                </span>
                <span className="text-[11px] leading-5 text-amber-700/80 dark:text-amber-300/80 font-mono">
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
        </div>
    </div>
  )
}
