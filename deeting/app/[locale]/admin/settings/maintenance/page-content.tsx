"use client"

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import useSWR from "swr"

import { AdminDataTable, AdminStatusBadge, type ColumnDef } from "@/components/admin"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { GlassCard } from "@/components/ui/glass-card"
import { isTauriRuntime } from "@/lib/api/desktop-config"
import {
  getLocalCapabilityRegistryDiagnostics,
  listLocalMaintenanceLogs,
  type LocalCapabilityRegistryParityItem,
  runLocalMaintenanceAction,
  type LocalCapabilityRegistryDiagnosticsResponse,
  type LocalMaintenanceLogItem,
} from "@/lib/api/desktop-system-assets"

function formatDate(value: string, locale: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date)
}

function getDetailNumber(details: unknown, key: string): number {
  if (!details || typeof details !== "object") return 0
  const value = (details as Record<string, unknown>)[key]
  return typeof value === "number" ? value : 0
}

function getNestedDetailNumber(details: unknown, parent: string, key: string): number {
  if (!details || typeof details !== "object") return 0
  const nested = (details as Record<string, unknown>)[parent]
  if (!nested || typeof nested !== "object") return 0
  const value = (nested as Record<string, unknown>)[key]
  return typeof value === "number" ? value : 0
}

export function PageContent() {
  const t = useTranslations("admin.maintenanceSettingsPage")
  const locale = useLocale()
  const supported = isTauriRuntime()
  const [mode, setMode] = useState<"repair" | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [repairConfirmOpen, setRepairConfirmOpen] = useState(false)
  const { data: history, mutate } = useSWR(
    supported ? "desktop-maintenance-history" : null,
    () => listLocalMaintenanceLogs({ limit: 10 })
  )
  const { data: diagnostics, mutate: mutateDiagnostics } = useSWR(
    supported ? "desktop-capability-registry-diagnostics" : null,
    () => getLocalCapabilityRegistryDiagnostics()
  )

  const formatLogMessage = (item: LocalMaintenanceLogItem) => {
    if (item.status === "failed") return item.message
    if (item.kind === "repair_local_index") {
      return t("feedback.repairApplied", {
        fetched: getNestedDetailNumber(item.details, "sync", "assets_fetched"),
        upserted: getNestedDetailNumber(item.details, "sync", "skill_install_upserted_count"),
        skills: getDetailNumber(item.details, "skill_reindexed_count"),
        assistants: getDetailNumber(item.details, "assistant_reindexed_count"),
      })
    }
    if (item.kind === "sync_reinstall_missing") {
      return t("feedback.syncReinstallApplied", {
        fetched: getDetailNumber(item.details, "skill_install_fetched_count"),
        upserted: getDetailNumber(item.details, "skill_install_upserted_count"),
        reinstalled: getDetailNumber(item.details, "skill_reinstalled_count"),
        failed: getDetailNumber(item.details, "skill_failed_count"),
      })
    }
    return t("feedback.syncApplied", {
      fetched: getDetailNumber(item.details, "skill_install_fetched_count"),
      upserted: getDetailNumber(item.details, "skill_install_upserted_count"),
      failed: getDetailNumber(item.details, "skill_failed_count"),
    })
  }

  const historyColumns: ColumnDef<LocalMaintenanceLogItem>[] = [
    {
      key: "kind",
      header: t("history.headers.action"),
      render: (row) => t(`history.kind.${row.kind}`),
    },
    {
      key: "status",
      header: t("history.headers.status"),
      render: (row) => (
        <AdminStatusBadge
          text={t(`history.status.${row.status}`)}
          tone={row.status === "success" ? "success" : "error"}
        />
      ),
    },
    {
      key: "message",
      header: t("history.headers.result"),
      render: (row) => <div className="max-w-[380px] text-xs text-[var(--muted)]">{formatLogMessage(row)}</div>,
    },
    {
      key: "created_at",
      header: t("history.headers.time"),
      render: (row) => <span className="text-xs text-[var(--muted)]">{formatDate(row.created_at, locale)}</span>,
    },
  ]

  const handleRepair = async () => {
    setRepairConfirmOpen(false)
    setFeedback(null)
    setMode("repair")
    try {
      const result = await runLocalMaintenanceAction({ kind: "repair_local_index" })
      setFeedback(result ? formatLogMessage(result) : t("feedback.repairAppliedNoop"))
      await Promise.all([mutate(), mutateDiagnostics()])
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : t("feedback.maintenanceFailed"))
    } finally {
      setMode(null)
    }
  }

  const diagnosticsSummary = diagnostics
    ? buildDiagnosticsSummary(diagnostics, t)
    : []
  const migrationGapLabels = diagnostics?.migration_gaps.map((gap) =>
    t(`diagnostics.migrationGaps.kind.${gap}`)
  ) ?? []

  return (
    <GlassCard padding="default" hover="none" className="max-w-3xl">
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-[var(--foreground)]">{t("section.title")}</h3>
          <p className="mt-1 text-xs text-[var(--muted)]">{t("section.description")}</p>
        </div>

        {!supported ? (
          <p className="text-xs text-[var(--muted)]">{t("empty.desktopOnly")}</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setRepairConfirmOpen(true)} disabled={mode !== null}>
                {mode === "repair" ? t("actions.repairingAction") : t("actions.repairIndexAction")}
              </Button>
            </div>
            <p className="text-xs text-[var(--muted)]">{t("section.note")}</p>
          </>
        )}

        {feedback ? <p className="text-xs text-[var(--muted)]" role="status">{feedback}</p> : null}

        {supported ? (
          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-[var(--foreground)]">{t("diagnostics.title")}</h3>
              <p className="mt-1 text-xs text-[var(--muted)]">{t("diagnostics.description")}</p>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {diagnosticsSummary.map((item) => (
                <div
                  key={item.label}
                  className="rounded-xl border border-[var(--border)] bg-[var(--card)]/70 px-3 py-2"
                >
                  <div className="text-[11px] uppercase tracking-[0.08em] text-[var(--muted)]">
                    {item.label}
                  </div>
                  <div className="mt-1 text-sm font-medium text-[var(--foreground)]">{item.value}</div>
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <div className="text-xs font-medium text-[var(--foreground)]">
                {t("diagnostics.migrationGaps.title")}
              </div>
              {migrationGapLabels.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {migrationGapLabels.map((label) => (
                    <span
                      key={label}
                      className="rounded-full border border-amber-300/70 bg-amber-50 px-2.5 py-1 text-[11px] text-amber-700"
                    >
                      {label}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-[var(--muted)]">{t("diagnostics.migrationGaps.empty")}</p>
              )}
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <ParityList
                title={t("diagnostics.parity.legacyOnlyTitle")}
                emptyMessage={t("diagnostics.parity.empty")}
                items={diagnostics?.legacy_only_assets ?? []}
              />
              <ParityList
                title={t("diagnostics.parity.registryFirstOnlyTitle")}
                emptyMessage={t("diagnostics.parity.empty")}
                items={diagnostics?.registry_first_only_assets ?? []}
              />
            </div>
          </div>
        ) : null}

        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-[var(--foreground)]">{t("history.title")}</h3>
          <AdminDataTable
            columns={historyColumns}
            data={history?.items ?? []}
            emptyMessage={t("history.empty")}
          />
        </div>
      </div>

      <AlertDialog open={repairConfirmOpen} onOpenChange={setRepairConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("repairConfirm.title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("repairConfirm.description")}</AlertDialogDescription>
          </AlertDialogHeader>
          <p className="text-sm text-amber-600 dark:text-amber-400">{t("repairConfirm.warning")}</p>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("repairConfirm.cancel")}</AlertDialogCancel>
            <AlertDialogAction className="bg-amber-500 hover:bg-amber-600 text-white" onClick={() => void handleRepair()} disabled={mode === "repair"}>
              {mode === "repair" ? t("actions.repairingAction") : t("repairConfirm.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </GlassCard>
  )
}

function buildDiagnosticsSummary(
  diagnostics: LocalCapabilityRegistryDiagnosticsResponse,
  t: ReturnType<typeof useTranslations>
) {
  return [
    {
      label: t("diagnostics.summary.readMode"),
      value: t(`diagnostics.readMode.${diagnostics.read_path_mode}`),
    },
    {
      label: t("diagnostics.summary.legacyReads"),
      value: diagnostics.legacy_control_plane_reads_enabled
        ? t("diagnostics.boolean.enabled")
        : t("diagnostics.boolean.disabled"),
    },
    {
      label: t("diagnostics.summary.registryEntries"),
      value: String(diagnostics.total),
    },
    {
      label: t("diagnostics.summary.directCallable"),
      value: String(diagnostics.direct_callable_count),
    },
    {
      label: t("diagnostics.summary.legacyOnly"),
      value: String(diagnostics.legacy_only_asset_count),
    },
    {
      label: t("diagnostics.summary.registryFirstOnly"),
      value: String(diagnostics.registry_first_only_asset_count),
    },
  ]
}

function formatParityMeta(item: LocalCapabilityRegistryParityItem) {
  return [item.source_type, item.asset_type, item.package_id].filter(Boolean).join(" · ")
}

function ParityList({
  title,
  emptyMessage,
  items,
}: {
  title: string
  emptyMessage: string
  items: LocalCapabilityRegistryParityItem[]
}) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)]/60 p-3">
      <div className="text-sm font-semibold text-[var(--foreground)]">{title}</div>
      {items.length === 0 ? (
        <p className="mt-2 text-xs text-[var(--muted)]">{emptyMessage}</p>
      ) : (
        <div className="mt-3 space-y-2">
          {items.slice(0, 8).map((item) => (
            <div
              key={item.key}
              className="rounded-xl border border-[var(--border)]/80 bg-[var(--background)]/80 px-3 py-2"
            >
              <div className="text-sm font-medium text-[var(--foreground)]">
                {item.name ?? item.asset_id ?? item.key}
              </div>
              <div className="mt-1 text-xs text-[var(--muted)]">{formatParityMeta(item)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
