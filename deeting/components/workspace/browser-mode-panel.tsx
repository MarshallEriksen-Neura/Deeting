"use client"

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
import { useBrowserModeStore } from "@/store/browser-mode-store"
import { useWorkspaceStore } from "@/store/workspace-store"
import { useState } from "react"

interface BrowserModePanelProps {
  viewId: string
  title: string
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
    <div className="h-full w-full p-6">
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="text-base">{title}</CardTitle>
          <CardDescription>{t("browserMode.panel.description")}</CardDescription>
          <CardAction className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
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
              onClick={() => pause(t("browserMode.panel.pausedStatus"))}
              aria-label={t("browserMode.panel.pause")}
            >
              {t("browserMode.panel.pause")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
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
              onClick={handleEnd}
              aria-label={endLabel}
            >
              {endLabel}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="grid gap-4">
          {isRecovering ? (
            <section className="grid gap-1 rounded-xl border border-amber-300/60 bg-amber-50/80 p-4 dark:border-amber-400/20 dark:bg-amber-500/10">
              <span className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                {t("browserMode.panel.recoveryTitle")}
              </span>
              <span className="text-xs text-amber-800/85 dark:text-amber-100/75">
                {t("browserMode.panel.recoveryDescription")}
              </span>
            </section>
          ) : null}

          <section className="grid gap-1 rounded-xl border border-border/60 bg-muted/20 p-4">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("browserMode.panel.connectionLabel")}
            </span>
            <span className="text-sm font-medium text-foreground">
              {resolvedConnectionLabel}
            </span>
            <span className="text-xs text-muted-foreground">
              {resolvedStatusDetail}
            </span>
          </section>

          <section className="grid gap-1 rounded-xl border border-border/60 bg-muted/20 p-4">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("browserMode.panel.pageLabel")}
            </span>
            <span className="text-sm font-medium text-foreground">
              {page?.title ?? t("browserMode.panel.pageEmpty")}
            </span>
            <span className="text-xs text-muted-foreground">{page?.host ?? ""}</span>
            <span className="truncate text-xs text-muted-foreground">{page?.url ?? ""}</span>
          </section>

          <section className="grid gap-1 rounded-xl border border-border/60 bg-muted/20 p-4">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("browserMode.panel.lastActionLabel")}
            </span>
            <span className="text-sm text-foreground">
              {lastAction?.summary ?? t("browserMode.panel.lastActionEmpty")}
            </span>
          </section>

          <section className="grid gap-1 rounded-xl border border-border/60 bg-muted/20 p-4">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("browserMode.panel.executionLabel")}
            </span>
            <span className="text-sm font-medium text-foreground">
              {t(`browserMode.panel.execution.${executionPhase}`)}
            </span>
            {executionLabel ? (
              <span className="text-xs text-muted-foreground">{executionLabel}</span>
            ) : null}
            {retryCount > 0 ? (
              <span className="text-xs text-muted-foreground">
                {t("browserMode.panel.retryCount", { count: retryCount })}
              </span>
            ) : null}
            {recoveryReason ? (
              <span className="text-xs text-muted-foreground">
                {recoveryReason}
              </span>
            ) : null}
          </section>

          {request?.prompt ? (
            <section className="grid gap-1 rounded-xl border border-border/60 bg-muted/20 p-4">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("browserMode.panel.requestLabel")}
              </span>
              <span className="text-sm text-foreground">{request.prompt}</span>
            </section>
          ) : null}

          {timeline.length > 0 ? (
            <section className="grid gap-2 rounded-xl border border-border/60 bg-muted/20 p-4">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("browserMode.panel.timelineLabel")}
              </span>
              <div className="grid gap-2">
                {timeline.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-lg border border-border/50 bg-background/60 px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm text-foreground">{entry.label}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {t(`browserMode.panel.execution.${entry.phase}`)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
