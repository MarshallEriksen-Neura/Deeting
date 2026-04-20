"use client"

import * as React from "react"
import { ArrowDownToLine, LoaderCircle, RefreshCw, Rocket } from "lucide-react"

import { Badge } from "@/ui/shadcn/badge"
import { Button } from "@/ui/shadcn/button"
import { Progress } from "@/ui/shadcn/progress"
import { useI18n } from "@/hooks/use-i18n"
import { useUpdateChecker } from "@/hooks/use-update-checker"
import { cn } from "@/lib/utils"

interface DesktopVersionManagementCardProps {
  isTauriRuntime: boolean
}

function extractReleaseHighlights(body: string): string[] {
  return body
    .split(/\r?\n/)
    .map((line) =>
      line
        .trim()
        .replace(/^#{1,3}\s+/, "")
        .replace(/^[-*]\s+/, "")
        .trim()
    )
    .filter(Boolean)
    .slice(0, 3)
}

export function DesktopVersionManagementCard({
  isTauriRuntime,
}: DesktopVersionManagementCardProps) {
  const t = useI18n("settings")
  const {
    currentVersion,
    isLoadingVersion,
    updateAvailable,
    updateInfo,
    downloading,
    progress,
    isChecking,
    checkStatus,
    errorMessage,
    checkForUpdate,
    installUpdate,
  } = useUpdateChecker({ autoCheckOnMount: false })

  const releaseHighlights = React.useMemo(
    () => extractReleaseHighlights(updateInfo?.body ?? ""),
    [updateInfo?.body]
  )

  if (!isTauriRuntime) {
    return null
  }

  const currentVersionLabel = isLoadingVersion
    ? t("version.currentLoading")
    : currentVersion
      ? `v${currentVersion}`
      : t("version.currentUnknown")

  const statusVariant: "default" | "secondary" | "destructive" =
    checkStatus === "update_available"
      ? "default"
      : checkStatus === "error"
        ? "destructive"
        : "secondary"

  let statusDescription = t("version.manualHint")
  if (checkStatus === "checking") {
    statusDescription = t("version.checkingDescription")
  } else if (checkStatus === "up_to_date") {
    statusDescription = t("version.upToDateDescription")
  } else if (checkStatus === "update_available") {
    statusDescription = t("version.latestDescription")
  } else if (checkStatus === "unavailable") {
    statusDescription = t("version.unavailableDescription")
  } else if (checkStatus === "error") {
    statusDescription = t("version.errorDescription")
  }

  return (
    <div className="rounded-2xl border border-border/40 bg-card/50 transition-colors hover:bg-card/70 dark:bg-card/30 dark:hover:bg-card/40">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/30 px-6 py-5">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-sky-600 dark:bg-sky-400/10 dark:text-sky-400">
            <Rocket className="h-4.5 w-4.5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              {t("version.title")}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("version.description")}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline" className="text-[11px]">
            {currentVersionLabel}
          </Badge>
          <Badge variant={statusVariant} className="text-[11px]">
            {t(`version.status.${checkStatus}`)}
          </Badge>
        </div>
      </div>

      <div className="space-y-4 px-6 py-5 text-sm">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-border/30 bg-muted/15 p-3 dark:bg-muted/10">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {t("version.currentLabel")}
            </p>
            <p className="mt-1 text-sm font-medium text-foreground">
              {currentVersionLabel}
            </p>
          </div>
          <div className="rounded-xl border border-border/30 bg-muted/15 p-3 dark:bg-muted/10">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {t("version.statusLabel")}
            </p>
            <p className="mt-1 text-sm font-medium text-foreground">
              {t(`version.status.${checkStatus}`)}
            </p>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">{statusDescription}</p>

        {errorMessage ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
            {errorMessage}
          </div>
        ) : null}

        {updateAvailable && updateInfo ? (
          <div className="space-y-3 rounded-xl border border-primary/20 bg-primary/[0.05] p-4 dark:bg-primary/[0.08]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold text-foreground">
                  {t("version.latestLabel")}
                </p>
                <p className="mt-1 text-sm font-medium text-foreground">
                  v{updateInfo.version}
                </p>
              </div>
              <Badge variant="default" className="text-[11px]">
                {t("version.status.update_available")}
              </Badge>
            </div>

            {releaseHighlights.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-foreground">
                  {t("version.releaseNotesLabel")}
                </p>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {releaseHighlights.map((item, index) => (
                    <li key={`${item}-${index}`} className="flex gap-2">
                      <span className="text-primary">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}

        {downloading ? (
          <div className="space-y-2 rounded-xl border border-border/30 bg-muted/15 p-4 dark:bg-muted/10">
            <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>{t("version.progressLabel")}</span>
              <span className="font-medium text-foreground">
                {t("version.progressValue", { progress })}
              </span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/30 px-6 py-3.5">
        <p className="text-[11px] text-muted-foreground/60">
          {t("version.footerHint")}
        </p>
        <div className="flex flex-wrap justify-end gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void checkForUpdate()
            }}
            disabled={isChecking || downloading}
            className="h-7 text-xs"
          >
            <RefreshCw
              className={cn("mr-1 h-3 w-3", isChecking && "animate-spin")}
            />
            {isChecking ? t("version.checkingButton") : t("version.check")}
          </Button>
          {updateAvailable && updateInfo ? (
            <Button
              type="button"
              size="sm"
              onClick={() => {
                void installUpdate()
              }}
              disabled={isChecking || downloading}
              className="h-7 text-xs"
            >
              {downloading ? (
                <LoaderCircle className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <ArrowDownToLine className="mr-1 h-3 w-3" />
              )}
              {downloading ? t("version.installing") : t("version.install")}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
