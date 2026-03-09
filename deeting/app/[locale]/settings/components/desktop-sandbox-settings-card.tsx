"use client"

import * as React from "react"
import { AlertTriangle, RefreshCw, Shield, Terminal, Wrench } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  GlassCard,
  GlassCardContent,
  GlassCardDescription,
  GlassCardFooter,
  GlassCardHeader,
  GlassCardTitle,
} from "@/components/ui/glass-card"
import { useI18n } from "@/hooks/use-i18n"
import {
  installLocalSandboxBoxlite,
  prepareLocalSandbox,
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

  if (!isTauriRuntime) {
    return null
  }

  const handleRefresh = async () => {
    await Promise.all([mutate(), guide.mutate()])
  }

  const handlePrepare = async () => {
    try {
      setIsPreparing(true)
      await prepareLocalSandbox()
      await handleRefresh()
      toast.success(t("agent.sandbox.prepareSuccess"))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("agent.sandbox.actionFailed"))
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
      toast.error(err instanceof Error ? err.message : t("agent.sandbox.actionFailed"))
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
      toast.error(err instanceof Error ? err.message : t("agent.sandbox.actionFailed"))
    } finally {
      setIsRepairing(false)
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
  const pythonSummary = data?.python
    ? !data.python.installed
      ? t("agent.sandbox.pythonMissing")
      : data.python.supported
        ? data.python.abi ?? t("agent.sandbox.pythonMissing")
        : `${data.python.abi ?? t("agent.sandbox.pythonMissing")} · ${t("agent.sandbox.pythonUnsupported")}`
    : null

  return (
    <GlassCard blur="default" theme="surface" hover="lift" padding="lg" className="border-0">
      <GlassCardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <GlassCardTitle className="text-lg text-foreground">
              {t("agent.sandbox.title")}
            </GlassCardTitle>
            <GlassCardDescription className="text-muted-foreground">
              {t("agent.sandbox.description")}
            </GlassCardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary" className="gap-1">
              <Shield className="h-3 w-3" />
              {t(`agent.sandbox.runtime.${runtimeKey}`)}
            </Badge>
            <Badge variant={data?.status === "ready" ? "default" : "outline"}>
              {t(`agent.sandbox.status.${readinessKey}`)}
            </Badge>
          </div>
        </div>
      </GlassCardHeader>
      <GlassCardContent className="space-y-4 text-sm">
        {isLoading ? (
          <p className="text-muted-foreground">{t("agent.sandbox.loading")}</p>
        ) : null}
        {error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-destructive">
            {String(error.message || error)}
          </div>
        ) : null}
        {data ? (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-border/60 p-3">
                <p className="text-xs text-muted-foreground">{t("agent.sandbox.providerLabel")}</p>
                <p className="mt-1 font-medium text-foreground">{data.provider_name}</p>
              </div>
              <div className="rounded-xl border border-border/60 p-3">
                <p className="text-xs text-muted-foreground">{t("agent.sandbox.platformLabel")}</p>
                <p className="mt-1 font-medium text-foreground">{data.platform}</p>
              </div>
            </div>
            <div className="space-y-2 rounded-xl border border-border/60 p-3">
              <p className="font-medium text-foreground">{t("agent.sandbox.diagnosticsTitle")}</p>
              <p className="text-muted-foreground">
                {data.blocking_reason ?? t("agent.sandbox.readyHint")}
              </p>
              {data.boxlite.endpoint ? (
                <p className="text-xs text-muted-foreground">
                  {t("agent.sandbox.endpointLabel")}: {data.boxlite.endpoint}
                </p>
              ) : null}
              {pythonSummary ? (
                <p className="text-xs text-muted-foreground">
                  {t("agent.sandbox.pythonLabel")}: {pythonSummary}
                </p>
              ) : null}
            </div>
          </>
        ) : null}
        {guide.data && data?.status !== "ready" ? (
          <div className="space-y-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600" />
              <div>
                <p className="font-medium text-foreground">{guide.data.title}</p>
                <p className="text-sm text-muted-foreground">{guide.data.description}</p>
              </div>
            </div>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {guide.data.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ul>
            {guide.data.primary_command ? (
              <div className="rounded-lg border border-border/60 bg-background/70 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">{t("agent.sandbox.commandLabel")}</p>
                    <p className="truncate font-mono text-xs text-foreground">{guide.data.primary_command}</p>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
                    <Terminal className="mr-2 h-4 w-4" />
                    {t("agent.sandbox.copyCommand")}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </GlassCardContent>
      <GlassCardFooter className="justify-between gap-3">
        <p className="text-xs text-muted-foreground">{t("agent.sandbox.footerHint")}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={handleRefresh}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {t("agent.sandbox.refresh")}
          </Button>
          {data?.status === "needs_boxlite" ? (
            <Button type="button" variant="outline" onClick={handleInstall} disabled={isInstalling}>
              <Shield className="mr-2 h-4 w-4" />
              {isInstalling ? t("agent.sandbox.installing") : t("agent.sandbox.install")}
            </Button>
          ) : null}
          {data?.can_auto_prepare && data.status !== "ready" ? (
            <Button type="button" variant="outline" onClick={handlePrepare} disabled={isPreparing}>
              <Shield className="mr-2 h-4 w-4" />
              {isPreparing ? t("agent.sandbox.preparing") : t("agent.sandbox.prepare")}
            </Button>
          ) : null}
          {data?.status === "repair_needed" ? (
            <Button type="button" onClick={handleRepair} disabled={isRepairing}>
              <Wrench className="mr-2 h-4 w-4" />
              {isRepairing ? t("agent.sandbox.repairing") : t("agent.sandbox.repair")}
            </Button>
          ) : null}
        </div>
      </GlassCardFooter>
    </GlassCard>
  )
}
