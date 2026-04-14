"use client"

import * as React from "react"
import { AlertTriangle, RefreshCw, Shield, Terminal, Wrench } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/hooks/use-i18n"
import {
  installLocalSandboxBoxlite,
  prepareLocalSandbox,
  rebuildLocalSandboxRuntime,
  repairLocalSandbox,
} from "@/lib/api/sandbox"
import { useSandboxInstallGuide, useSandboxStatus } from "@/lib/swr/use-sandbox-status"

interface DesktopSandboxSettingsCardProps {
  isTauriRuntime: boolean
}

export function DesktopSandboxSettingsCard({
  isTauriRuntime,
}: DesktopSandboxSettingsCardProps) {
  const t = useI18n("settings")
  const { data, isLoading, error, mutate } = useSandboxStatus({ enabled: isTauriRuntime })
  const guide = useSandboxInstallGuide(
    Boolean(isTauriRuntime && data && data.status !== "ready")
  )
  const [isInstalling, setIsInstalling] = React.useState(false)
  const [isPreparing, setIsPreparing] = React.useState(false)
  const [isRepairing, setIsRepairing] = React.useState(false)
  const [isRebuilding, setIsRebuilding] = React.useState(false)

  if (!isTauriRuntime) {
    return null
  }

  const handleRefresh = async () => {
    await Promise.all([mutate(), guide.mutate()])
  }

  const formatActionError = (err: unknown) => {
    if (err instanceof Error && err.message) {
      return err.message
    }
    if (typeof err === "string" && err) {
      return err
    }
    return t("agent.sandbox.actionFailed")
  }

  const handlePrepare = async () => {
    try {
      setIsPreparing(true)
      await prepareLocalSandbox()
      await handleRefresh()
      toast.success(t("agent.sandbox.prepareSuccess"))
    } catch (err) {
      toast.error(formatActionError(err))
    } finally {
      setIsPreparing(false)
    }
  }

  const handleInstall = async () => {
    try {
      setIsInstalling(true)
      await installLocalSandboxBoxlite()
      await handleRefresh()
      toast.success(t("agent.sandbox.installSuccess"))
    } catch (err) {
      toast.error(formatActionError(err))
    } finally {
      setIsInstalling(false)
    }
  }

  const handleRepair = async () => {
    try {
      setIsRepairing(true)
      await repairLocalSandbox()
      await handleRefresh()
      toast.success(t("agent.sandbox.repairSuccess"))
    } catch (err) {
      toast.error(formatActionError(err))
    } finally {
      setIsRepairing(false)
    }
  }

  const handleRebuild = async () => {
    try {
      setIsRebuilding(true)
      await rebuildLocalSandboxRuntime()
      await handleRefresh()
      toast.success(t("agent.sandbox.rebuildSuccess"))
    } catch (err) {
      toast.error(formatActionError(err))
    } finally {
      setIsRebuilding(false)
    }
  }

  const handleCopy = async () => {
    const command = guide.data?.primary_command
    if (!command) return
    await navigator.clipboard.writeText(command)
    toast.success(t("agent.sandbox.copySuccess"))
  }

  const readinessKey = data?.status ?? "unsupported"
  const runtimeKey = data?.runtime_mode ?? "disabled"
  const executionProbeKey = data?.execution_probe.status ?? "skipped"
  const pythonSummary = null

  return (
    <div className="rounded-2xl border border-border/40 bg-card/50 transition-colors hover:bg-card/70 dark:bg-card/30 dark:hover:bg-card/40">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/30 px-6 py-5">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-600 dark:bg-indigo-400/10 dark:text-indigo-400">
            <Shield className="h-4.5 w-4.5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              {t("agent.sandbox.title")}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("agent.sandbox.description")}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="secondary" className="gap-1 text-[11px]">
            <Shield className="h-3 w-3" />
            {t(`agent.sandbox.runtime.${runtimeKey}`)}
          </Badge>
          <Badge
            variant={data?.status === "ready" ? "default" : "outline"}
            className="text-[11px]"
          >
            {t(`agent.sandbox.status.${readinessKey}`)}
          </Badge>
        </div>
      </div>

      {/* Content */}
      <div className="space-y-4 px-6 py-5 text-sm">
        {isLoading ? (
          <p className="text-muted-foreground">{t("agent.sandbox.loading")}</p>
        ) : null}

        {error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
            {String(error.message || error)}
          </div>
        ) : null}

        {data ? (
          <>
            {/* Status grid */}
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-border/30 bg-muted/15 p-3 dark:bg-muted/10">
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {t("agent.sandbox.providerLabel")}
                </p>
                <p className="mt-1 text-sm font-medium text-foreground">{data.provider_name}</p>
              </div>
              <div className="rounded-xl border border-border/30 bg-muted/15 p-3 dark:bg-muted/10">
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {t("agent.sandbox.platformLabel")}
                </p>
                <p className="mt-1 text-sm font-medium text-foreground">{data.platform}</p>
              </div>
            </div>

            {/* Diagnostics */}
            <div className="space-y-2 rounded-xl border border-border/30 bg-muted/15 p-4 dark:bg-muted/10">
              <p className="text-xs font-semibold text-foreground">{t("agent.sandbox.diagnosticsTitle")}</p>
              <p className="text-xs text-muted-foreground">
                {data.blocking_reason ?? t("agent.sandbox.readyHint")}
              </p>
              {data.boxlite.endpoint ? (
                <p className="text-[11px] text-muted-foreground">
                  {t("agent.sandbox.endpointLabel")}: {data.boxlite.endpoint}
                </p>
              ) : null}
              {pythonSummary ? (
                <p className="text-[11px] text-muted-foreground">
                  {t("agent.sandbox.pythonLabel")}: {pythonSummary}
                </p>
              ) : null}
              <p className="text-[11px] text-muted-foreground">
                {t("agent.sandbox.bridgeLabel")}:{" "}
                {data.boxlite.reachable
                  ? t("agent.sandbox.bridgeReachable")
                  : t("agent.sandbox.bridgeUnreachable")}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {t("agent.sandbox.executionProbeLabel")}:{" "}
                {t(`agent.sandbox.executionProbe${executionProbeKey.charAt(0).toUpperCase()}${executionProbeKey.slice(1)}`)}
              </p>
              {data.execution_probe.detail ? (
                <p className="text-[11px] text-muted-foreground">
                  {data.execution_probe.detail}
                </p>
              ) : null}
              <p className="text-[11px] text-muted-foreground">
                {t("agent.sandbox.ownershipLabel")}:{" "}
                {data.boxlite.managed_by_deeting
                  ? t("agent.sandbox.managed")
                  : t("agent.sandbox.external")}
              </p>
              {data.next_actions.length > 0 ? (
                <div className="pt-1">
                  <p className="text-[11px] font-semibold text-foreground">
                    {t("agent.sandbox.nextActionsTitle")}
                  </p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[11px] text-muted-foreground">
                    {data.next_actions.map((action) => (
                      <li key={action}>{action}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </>
        ) : null}

        {/* Install guide */}
        {guide.data && data?.status !== "ready" ? (
          <div className="space-y-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-4 dark:border-amber-400/15 dark:bg-amber-400/[0.06]">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div>
                <p className="text-sm font-medium text-foreground">{guide.data.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{guide.data.description}</p>
              </div>
            </div>
            <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
              {guide.data.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ul>
            {guide.data.primary_command ? (
              <div className="rounded-lg border border-border/30 bg-background/60 p-3 dark:bg-background/30">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] text-muted-foreground">{t("agent.sandbox.commandLabel")}</p>
                    <p className="truncate font-mono text-xs text-foreground">{guide.data.primary_command}</p>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={handleCopy} className="shrink-0">
                    <Terminal className="mr-1.5 h-3.5 w-3.5" />
                    {t("agent.sandbox.copyCommand")}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Footer with actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/30 px-6 py-3.5">
        <p className="text-[11px] text-muted-foreground/60">{t("agent.sandbox.footerHint")}</p>
        <div className="flex flex-wrap justify-end gap-1.5">
          <Button type="button" variant="ghost" size="sm" onClick={handleRefresh} className="h-7 text-xs">
            <RefreshCw className="mr-1 h-3 w-3" />
            {t("agent.sandbox.refresh")}
          </Button>
          {data?.status === "needs_boxlite" ? (
            <Button type="button" variant="outline" size="sm" onClick={handleInstall} disabled={isInstalling} className="h-7 text-xs">
              <Shield className="mr-1 h-3 w-3" />
              {isInstalling ? t("agent.sandbox.installing") : t("agent.sandbox.install")}
            </Button>
          ) : null}
          {data?.can_auto_prepare && data.status !== "ready" ? (
            <Button type="button" variant="outline" size="sm" onClick={handlePrepare} disabled={isPreparing} className="h-7 text-xs">
              <Shield className="mr-1 h-3 w-3" />
              {isPreparing ? t("agent.sandbox.preparing") : t("agent.sandbox.prepare")}
            </Button>
          ) : null}
          {data?.status === "repair_needed" ? (
            <Button type="button" size="sm" onClick={handleRepair} disabled={isRepairing} className="h-7 text-xs">
              <Wrench className="mr-1 h-3 w-3" />
              {isRepairing ? t("agent.sandbox.repairing") : t("agent.sandbox.repair")}
            </Button>
          ) : null}
          {data ? (
            <Button type="button" variant="outline" size="sm" onClick={handleRebuild} disabled={isRebuilding} className="h-7 text-xs">
              <Wrench className="mr-1 h-3 w-3" />
              {isRebuilding ? t("agent.sandbox.rebuilding") : t("agent.sandbox.rebuild")}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
