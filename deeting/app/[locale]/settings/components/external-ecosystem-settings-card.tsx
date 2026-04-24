"use client"

import { useCallback, useEffect, useState } from "react"
import { Orbit, ShieldCheck } from "lucide-react"

import { useI18n } from "@/hooks/use-i18n"
import {
  createExternalSource,
  listExternalSources,
  type CreateExternalSourcePayload,
  type ExternalSourceRecord,
} from "@/lib/api/external-sources"
import { Button } from "@/ui/shadcn/button"
import { toast } from "sonner"
import { ExternalSourceCreateDialog } from "./external-source-create-dialog"
import { ExternalSourceCard } from "./external-source-card"

interface ExternalEcosystemSettingsCardProps {
  isTauriRuntime: boolean
}

export function ExternalEcosystemSettingsCard({
  isTauriRuntime,
}: ExternalEcosystemSettingsCardProps) {
  const t = useI18n("settings")
  const [sources, setSources] = useState<ExternalSourceRecord[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const loadSources = useCallback(async () => {
    setIsLoading(true)
    try {
      const next = await listExternalSources()
      setSources(next)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("ecosystem.toast.loadFailed")
      toast.error(message)
    } finally {
      setIsLoading(false)
    }
  }, [t])

  useEffect(() => {
    if (!isTauriRuntime) return
    loadSources().catch(() => {})
  }, [isTauriRuntime, loadSources])

  async function handleCreate(payload: CreateExternalSourcePayload) {
    try {
      const created = await createExternalSource(payload)
      setSources((current) => [created, ...current])
      toast.success(t("ecosystem.toast.created"))
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("ecosystem.toast.createFailed")
      toast.error(message)
      throw error
    }
  }

  function handleChanged(nextSource: ExternalSourceRecord) {
    setSources((current) =>
      current.map((item) => (item.id === nextSource.id ? nextSource : item))
    )
  }

  function handleDeleted(sourceId: string) {
    setSources((current) => current.filter((item) => item.id !== sourceId))
  }

  if (!isTauriRuntime) {
    return null
  }

  return (
    <div className="rounded-2xl border border-border/40 bg-card/50 transition-colors hover:bg-card/70 dark:bg-card/30 dark:hover:bg-card/40">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/30 px-6 py-5">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-600 dark:bg-cyan-400/10 dark:text-cyan-400">
            <Orbit className="h-4.5 w-4.5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              {t("ecosystem.title")}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("ecosystem.description")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span>{t("ecosystem.securityHint")}</span>
        </div>
      </div>

      <div className="space-y-5 px-6 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-3xl text-sm text-muted-foreground">
            {t("ecosystem.intro")}
          </p>
          <ExternalSourceCreateDialog onCreate={handleCreate}>
            <Button type="button">{t("ecosystem.create.trigger")}</Button>
          </ExternalSourceCreateDialog>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">{t("ecosystem.loading")}</p>
        ) : sources.length === 0 ? (
          <div className="rounded-[1.5rem] border border-dashed border-[var(--hairline)] bg-[var(--panel-bg)] px-5 py-6 text-sm text-[var(--ink-3)] backdrop-blur-sm">
            {t("ecosystem.empty")}
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {sources.map((source) => (
              <ExternalSourceCard
                key={source.id}
                source={source}
                onChanged={handleChanged}
                onDeleted={handleDeleted}
              />
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-end border-t border-border/30 px-6 py-3">
        <span className="text-[11px] text-muted-foreground/60">
          {t("ecosystem.footerHint")}
        </span>
      </div>
    </div>
  )
}
