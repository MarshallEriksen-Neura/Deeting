"use client"

import * as React from "react"
import {
  Camera,
  Globe,
  MousePointerClick,
  RefreshCw,
  Search,
  Type,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/ui/shadcn/badge"
import { GlassButton } from "@/ui/common/glass-button"
import { Input } from "@/ui/shadcn/input"
import { Label } from "@/ui/shadcn/label"
import { Textarea } from "@/ui/shadcn/textarea"
import { useI18n } from "@/hooks/use-i18n"
import {
  clickLocalBrowserAgentElement,
  getLocalBrowserAgentBridgeStatus,
  getLocalBrowserAgentBridgeUrl,
  getLocalBrowserAgentPageSnapshot,
  navigateLocalBrowserAgentTab,
  openLocalBrowserAgentTab,
  queryLocalBrowserAgentDom,
  setLocalBrowserAgentBridgeUrl,
  typeLocalBrowserAgentElement,
  type BrowserAgentBridgeStatus,
  type BrowserAgentElementLocator,
} from "@/lib/api/browser-agent"
import { isBrowserAgentPanelEnabled } from "./browser-agent-panel-flags"

function formatError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === "string" && err) return err
  return "unknown_error"
}

interface DesktopBrowserAgentPanelCardProps {
  isTauriRuntime: boolean
}

export function DesktopBrowserAgentPanelCard({
  isTauriRuntime,
}: DesktopBrowserAgentPanelCardProps) {
  const isPanelEnabled = isBrowserAgentPanelEnabled()
  const t = useI18n("settings")
  const [status, setStatus] = React.useState<BrowserAgentBridgeStatus | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isWorking, setIsWorking] = React.useState(false)

  const [bridgeUrl, setBridgeUrl] = React.useState("")
  const [bridgeUrlDraft, setBridgeUrlDraft] = React.useState("")

  const [tabIdDraft, setTabIdDraft] = React.useState("")
  const parsedTabId = tabIdDraft.trim() ? Number(tabIdDraft.trim()) : null
  const tabId = parsedTabId != null && Number.isFinite(parsedTabId) ? parsedTabId : null

  const [openUrlDraft, setOpenUrlDraft] = React.useState("https://example.com")
  const [navigateUrlDraft, setNavigateUrlDraft] = React.useState("")

  const [targetSelector, setTargetSelector] = React.useState("")
  const [targetText, setTargetText] = React.useState("")
  const [typeTextDraft, setTypeTextDraft] = React.useState("")

  const [querySelector, setQuerySelector] = React.useState("")
  const [queryTextQuery, setQueryTextQuery] = React.useState("")

  const [lastAction, setLastAction] = React.useState<string | null>(null)
  const [lastResult, setLastResult] = React.useState<string>("")
  const [lastError, setLastError] = React.useState<string | null>(null)

  const refreshStatus = React.useCallback(async () => {
    if (!isTauriRuntime) return
    try {
      setIsLoading(true)
      const [nextStatus, nextBridgeUrl] = await Promise.all([
        getLocalBrowserAgentBridgeStatus(),
        getLocalBrowserAgentBridgeUrl(),
      ])
      setStatus(nextStatus)
      setBridgeUrl(nextBridgeUrl)
      setBridgeUrlDraft(nextBridgeUrl)
    } catch (err) {
      setLastError(formatError(err))
    } finally {
      setIsLoading(false)
    }
  }, [isTauriRuntime])

  React.useEffect(() => {
    if (!isTauriRuntime || !isPanelEnabled) return
    refreshStatus()
  }, [isTauriRuntime, refreshStatus])

  if (!isTauriRuntime || !isPanelEnabled) {
    return null
  }

  const runAction = async <T,>(name: string, fn: () => Promise<T>) => {
    try {
      setIsWorking(true)
      setLastAction(name)
      setLastError(null)
      const result = await fn()
      setLastResult(JSON.stringify(result, null, 2) ?? "")
    } catch (err) {
      const message = formatError(err)
      setLastError(message)
      toast.error(message)
    } finally {
      setIsWorking(false)
    }
  }

  const buildTarget = () => {
    const selector = targetSelector.trim()
    const text = targetText.trim()
    const target: BrowserAgentElementLocator = {}
    if (selector) target.selector = selector
    if (text) target.text = text
    return target
  }

  const requireTabId = () => {
    if (!tabId) {
      toast.error(t("browserAgent.missingTabId"))
      return null
    }
    return tabId
  }

  const requireTarget = () => {
    const selector = targetSelector.trim()
    const text = targetText.trim()
    if (!selector && !text) {
      toast.error(t("browserAgent.missingTarget"))
      return null
    }
    return buildTarget()
  }

  const statusBadge =
    status?.status && status.status !== "unsupported" ? status.status : "unknown"

  return (
    <div className="rounded-2xl border border-border/40 bg-card/50 transition-colors hover:bg-card/70 dark:bg-card/30 dark:hover:bg-card/40">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/30 px-6 py-5">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-sky-600 dark:bg-sky-400/10 dark:text-sky-400">
            <Globe className="h-4.5 w-4.5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              {t("browserAgent.title")}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("browserAgent.description")}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="secondary" className="text-[11px]">
            {t("browserAgent.badge")}
          </Badge>
          <Badge variant="outline" className="text-[11px]">
            {statusBadge}
          </Badge>
        </div>
      </div>

      <div className="space-y-5 px-6 py-5">
        {isLoading ? (
          <p className="text-xs text-muted-foreground">
            {t("browserAgent.loading")}
          </p>
        ) : null}

        {lastError ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
            {lastError}
          </div>
        ) : null}

        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-border/30 bg-muted/15 p-3 dark:bg-muted/10">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {t("browserAgent.status")}
            </p>
            <p className="mt-1 text-sm font-medium text-foreground">
              {status?.status ?? "-"} · {status?.status_reason ?? "-"}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {t("browserAgent.sessions")}: {status?.connected_sessions ?? 0}
            </p>
          </div>
          <div className="rounded-xl border border-border/30 bg-muted/15 p-3 dark:bg-muted/10">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {t("browserAgent.bridgeUrl")}
            </p>
            <p className="mt-1 truncate font-mono text-xs text-foreground">
              {bridgeUrl || "-"}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {t("browserAgent.bridgeRunning")}: {String(status?.running ?? false)} ·{" "}
              {t("browserAgent.bridgeReachable")}: {String(status?.reachable ?? false)}
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="browser-agent-bridge-url" className="text-xs font-medium">
            {t("browserAgent.bridgeUrlLabel")}
          </Label>
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <Input
              id="browser-agent-bridge-url"
              value={bridgeUrlDraft}
              onChange={(e) => setBridgeUrlDraft(e.target.value)}
              disabled={isWorking}
              className="rounded-xl font-mono text-xs"
            />
            <div className="flex gap-2">
              <GlassButton
                type="button"
                size="sm"
                variant="secondary"
                onClick={() =>
                  runAction("set_bridge_url", async () => {
                    const next = await setLocalBrowserAgentBridgeUrl(bridgeUrlDraft)
                    setBridgeUrl(next)
                    setBridgeUrlDraft(next)
                    await refreshStatus()
                    toast.success(t("browserAgent.bridgeSaved"))
                    return { bridge_url: next }
                  })
                }
                disabled={isWorking}
              >
                {t("browserAgent.save")}
              </GlassButton>
              <GlassButton
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => runAction("refresh_status", refreshStatus)}
                disabled={isWorking}
              >
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                {t("browserAgent.refresh")}
              </GlassButton>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t("browserAgent.bridgeUrlHelp")}</p>
        </div>

        <div className="rounded-xl border border-border/30 bg-muted/10 p-4 dark:bg-muted/5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="browser-agent-tab-id" className="text-xs font-medium">
                {t("browserAgent.tabIdLabel")}
              </Label>
              <Input
                id="browser-agent-tab-id"
                value={tabIdDraft}
                onChange={(e) => setTabIdDraft(e.target.value)}
                placeholder="42"
                disabled={isWorking}
                className="rounded-xl"
              />
              <p className="text-[11px] text-muted-foreground">
                {t("browserAgent.tabIdHelp")}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="browser-agent-open-url" className="text-xs font-medium">
                {t("browserAgent.openUrlLabel")}
              </Label>
              <div className="flex gap-2">
                <Input
                  id="browser-agent-open-url"
                  value={openUrlDraft}
                  onChange={(e) => setOpenUrlDraft(e.target.value)}
                  disabled={isWorking}
                  className="rounded-xl"
                />
                <GlassButton
                  type="button"
                  size="sm"
                  onClick={() =>
                    runAction("open_tab", async () => {
                      const res = await openLocalBrowserAgentTab(openUrlDraft)
                      if (res.tabId != null) setTabIdDraft(String(res.tabId))
                      toast.success(t("browserAgent.opened"))
                      return res
                    })
                  }
                  disabled={isWorking}
                >
                  {t("browserAgent.open")}
                </GlassButton>
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="browser-agent-navigate-url" className="text-xs font-medium">
                {t("browserAgent.navigateUrlLabel")}
              </Label>
              <div className="flex gap-2">
                <Input
                  id="browser-agent-navigate-url"
                  value={navigateUrlDraft}
                  onChange={(e) => setNavigateUrlDraft(e.target.value)}
                  disabled={isWorking}
                  className="rounded-xl"
                />
                <GlassButton
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    const currentTabId = requireTabId()
                    if (currentTabId == null) return
                    runAction("navigate_tab", async () => {
                      const res = await navigateLocalBrowserAgentTab(
                        currentTabId,
                        navigateUrlDraft
                      )
                      toast.success(t("browserAgent.navigated"))
                      return res
                    })
                  }}
                  disabled={isWorking}
                >
                  {t("browserAgent.navigate")}
                </GlassButton>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-medium">{t("browserAgent.snapshotLabel")}</Label>
              <GlassButton
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => {
                  const currentTabId = requireTabId()
                  if (currentTabId == null) return
                  runAction("page_snapshot", () =>
                    getLocalBrowserAgentPageSnapshot(currentTabId)
                  )
                }}
                disabled={isWorking}
              >
                <Camera className="mr-1.5 h-3.5 w-3.5" />
                {t("browserAgent.snapshot")}
              </GlassButton>
              <p className="text-[11px] text-muted-foreground">
                {t("browserAgent.snapshotHelp")}
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-3">
            <p className="text-xs font-semibold text-foreground">
              {t("browserAgent.targetTitle")}
            </p>
            <div className="space-y-2">
              <Label htmlFor="browser-agent-target-selector" className="text-xs font-medium">
                {t("browserAgent.selectorLabel")}
              </Label>
              <Input
                id="browser-agent-target-selector"
                value={targetSelector}
                onChange={(e) => setTargetSelector(e.target.value)}
                disabled={isWorking}
                className="rounded-xl font-mono text-xs"
                placeholder=".button.primary"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="browser-agent-target-text" className="text-xs font-medium">
                {t("browserAgent.textLabel")}
              </Label>
              <Input
                id="browser-agent-target-text"
                value={targetText}
                onChange={(e) => setTargetText(e.target.value)}
                disabled={isWorking}
                className="rounded-xl"
                placeholder={t("browserAgent.textPlaceholder")}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <GlassButton
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => {
                  const currentTabId = requireTabId()
                  if (currentTabId == null) return
                  const target = requireTarget()
                  if (!target) return
                  runAction("click", () =>
                    clickLocalBrowserAgentElement(currentTabId, target)
                  )
                }}
                disabled={isWorking}
              >
                <MousePointerClick className="mr-1.5 h-3.5 w-3.5" />
                {t("browserAgent.click")}
              </GlassButton>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {t("browserAgent.targetHelp")}
            </p>
          </div>

          <div className="space-y-3">
            <p className="text-xs font-semibold text-foreground">
              {t("browserAgent.typeTitle")}
            </p>
            <div className="space-y-2">
              <Label htmlFor="browser-agent-type-text" className="text-xs font-medium">
                {t("browserAgent.typeTextLabel")}
              </Label>
              <Input
                id="browser-agent-type-text"
                value={typeTextDraft}
                onChange={(e) => setTypeTextDraft(e.target.value)}
                disabled={isWorking}
                className="rounded-xl"
                placeholder={t("browserAgent.typeTextPlaceholder")}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <GlassButton
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => {
                  const currentTabId = requireTabId()
                  if (currentTabId == null) return
                  const target = requireTarget()
                  if (!target) return
                  runAction("type", () =>
                    typeLocalBrowserAgentElement(
                      currentTabId,
                      target,
                      typeTextDraft
                    )
                  )
                }}
                disabled={isWorking}
              >
                <Type className="mr-1.5 h-3.5 w-3.5" />
                {t("browserAgent.type")}
              </GlassButton>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {t("browserAgent.typeHelp")}
            </p>
          </div>
        </div>

        <div className="space-y-3 rounded-xl border border-border/30 bg-muted/10 p-4 dark:bg-muted/5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold text-foreground">
              {t("browserAgent.queryTitle")}
            </p>
            <GlassButton
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                const currentTabId = requireTabId()
                if (currentTabId == null) return
                runAction("query_dom", () =>
                  queryLocalBrowserAgentDom(currentTabId, {
                    selector: querySelector.trim() || undefined,
                    textQuery: queryTextQuery.trim() ? queryTextQuery.trim() : null,
                  })
                )
              }}
              disabled={isWorking}
            >
              <Search className="mr-1.5 h-3.5 w-3.5" />
              {t("browserAgent.query")}
            </GlassButton>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="browser-agent-query-selector" className="text-xs font-medium">
                {t("browserAgent.querySelectorLabel")}
              </Label>
              <Input
                id="browser-agent-query-selector"
                value={querySelector}
                onChange={(e) => setQuerySelector(e.target.value)}
                disabled={isWorking}
                className="rounded-xl font-mono text-xs"
                placeholder=".result"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="browser-agent-query-text" className="text-xs font-medium">
                {t("browserAgent.queryTextLabel")}
              </Label>
              <Input
                id="browser-agent-query-text"
                value={queryTextQuery}
                onChange={(e) => setQueryTextQuery(e.target.value)}
                disabled={isWorking}
                className="rounded-xl"
                placeholder={t("browserAgent.queryTextPlaceholder")}
              />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">{t("browserAgent.queryHelp")}</p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-foreground">
              {t("browserAgent.resultTitle")}
            </p>
            {lastAction ? (
              <span className="text-[11px] text-muted-foreground">
                {t("browserAgent.lastAction")}: {lastAction}
              </span>
            ) : null}
          </div>
          <Textarea
            value={lastResult}
            readOnly
            placeholder={t("browserAgent.resultPlaceholder")}
            className="min-h-44 rounded-xl font-mono text-xs"
          />
        </div>
      </div>
    </div>
  )
}
