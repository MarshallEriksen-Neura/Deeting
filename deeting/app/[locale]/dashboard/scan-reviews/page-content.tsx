"use client"

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import useSWR from "swr"
import { AlertTriangle, Database, Files, RefreshCcw } from "lucide-react"
import {
  AdminDataTable,
  AdminFilterBar,
  AdminStatCards,
  AdminStatusBadge,
  type ColumnDef,
  type StatCardData,
} from "@/components/admin"
import { Button } from "@/components/ui/button"
import { isTauriRuntime } from "@/lib/api/desktop-config"
import {
  runScanReviewAction,
  runScanReviewActions,
  scanDirectoryReview,
  type LocalScanFindingAction,
  type LocalScanRun,
} from "@/lib/api/local-scan"

function formatDate(value: string | null | undefined, locale: string) {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date)
}

function toneForSeverity(severity: string) {
  if (severity === "error") return "error" as const
  if (severity === "warn") return "warn" as const
  if (severity === "info") return "info" as const
  return "default" as const
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asTrimmedString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function readRiskPreview(metadata: unknown) {
  const meta = toRecord(metadata)
  const riskPreview = toRecord(meta?.risk_preview)
  if (!riskPreview) return null
  return {
    riskLevel: asTrimmedString(riskPreview.risk_level),
    operationClass: asTrimmedString(riskPreview.operation_class),
    targetClass: asTrimmedString(riskPreview.target_class),
    boundaryClass: asTrimmedString(riskPreview.boundary_class),
  }
}

function readRiskMetadata(metadata: unknown) {
  const meta = toRecord(metadata)
  if (!meta) return null
  return {
    riskLevel: asTrimmedString(meta.risk_level),
    operationClass: asTrimmedString(meta.operation_class),
    targetClass: asTrimmedString(meta.target_class),
    boundaryClass: asTrimmedString(meta.boundary_class),
  }
}

function formatRiskTuple(parts: Array<string | null>) {
  const compact = parts.filter((part): part is string => Boolean(part))
  return compact.length > 0 ? compact.join(" · ") : null
}

export function PageContent() {
  const t = useTranslations("dashboard.scanReviewsPage")
  const locale = useLocale()
  const supported = isTauriRuntime()
  const [searchQuery, setSearchQuery] = useState("")
  const [severityFilter, setSeverityFilter] = useState("")
  const [boundaryFilter, setBoundaryFilter] = useState("")
  const [operationFilter, setOperationFilter] = useState("")
  const [feedback, setFeedback] = useState<string | null>(null)
  const [actioningId, setActioningId] = useState<string | null>(null)
  const [batchRunning, setBatchRunning] = useState(false)
  const { data, error, isLoading, isValidating, mutate } = useSWR<LocalScanRun | null>(
    supported ? "desktop-scan-review" : null,
    () => scanDirectoryReview()
  )

  const query = searchQuery.trim().toLowerCase()
  const documents = useMemo(() => {
    const rows = data?.documents ?? []
    return rows.filter((row) => {
      if (!query) return true
      return [row.display_name, row.bundle_id, row.relative_path, row.path, row.excerpt]
        .some((value) => String(value ?? "").toLowerCase().includes(query))
    })
  }, [data?.documents, query])

  const findings = useMemo(() => {
    const rows = data?.findings ?? []
    return rows.filter((row) => {
      if (severityFilter && row.severity !== severityFilter) return false
      const riskMeta = readRiskMetadata(row.metadata)
      if (boundaryFilter && riskMeta?.boundaryClass !== boundaryFilter) return false
      if (operationFilter && riskMeta?.operationClass !== operationFilter) return false
      if (!query) return true
      return [row.code, row.message, row.bundle_id, row.document_path]
        .some((value) => String(value ?? "").toLowerCase().includes(query))
    })
  }, [boundaryFilter, data?.findings, operationFilter, query, severityFilter])

  const stats: StatCardData[] = [
    { label: t("stats.documents"), value: data?.summary.document_count ?? 0, color: "primary", icon: Files },
    { label: t("stats.skillBundles"), value: data?.summary.skill_bundle_count ?? 0, color: "teal", icon: Files },
    { label: t("stats.missingIndexes"), value: data?.summary.index_missing_count ?? 0, color: "amber", icon: Database },
    { label: t("stats.needsReview"), value: (data?.summary.warning_count ?? 0) + (data?.summary.error_count ?? 0), color: "rose", icon: AlertTriangle },
  ]

  const hasFindingActions = findings.some((row) => row.action)
  const actionableFindings = useMemo(
    () => (data?.findings ?? []).flatMap((row) => (row.action ? [row.action] : [])),
    [data?.findings]
  )

  const documentColumns: ColumnDef<LocalScanRun["documents"][number]>[] = [
    {
      key: "display_name",
      header: t("table.documents.headers.document"),
      render: (row) => (
        <div>
          <div className="font-medium">{row.display_name}</div>
          <div className="font-mono text-[10px] text-[var(--muted)]">{row.bundle_id ?? row.document_kind}</div>
          <div className="truncate text-xs text-[var(--muted)]">{row.relative_path ?? row.path}</div>
        </div>
      ),
    },
    {
      key: "status",
      header: t("table.documents.headers.status"),
      render: (row) => <AdminStatusBadge text={t(`status.${row.status}`)} tone={row.status === "healthy" ? "success" : "warn"} />,
    },
    {
      key: "document_kind",
      header: t("table.documents.headers.kind"),
      render: (row) => <span className="text-xs text-[var(--muted)]">{row.document_kind}</span>,
    },
    {
      key: "excerpt",
      header: t("table.documents.headers.summary"),
      render: (row) => {
        const riskPreview = readRiskPreview(row.metadata)
        const riskLine = formatRiskTuple([
          riskPreview?.riskLevel,
          riskPreview?.operationClass,
          riskPreview?.boundaryClass,
        ])
        return (
          <div className="max-w-[320px] space-y-1 text-xs text-[var(--muted)]">
            <div>{row.excerpt ?? "—"}</div>
            {riskLine ? <div className="font-mono">{riskLine}</div> : null}
          </div>
        )
      },
    },
  ]

  const findingColumns: ColumnDef<LocalScanRun["findings"][number]>[] = [
    {
      key: "code",
      header: t("table.findings.headers.finding"),
      render: (row) => (
        <div>
          <div className="font-medium">{row.code}</div>
          <div className="truncate text-xs text-[var(--muted)]">{row.bundle_id ?? row.document_path ?? "—"}</div>
        </div>
      ),
    },
    {
      key: "severity",
      header: t("table.findings.headers.severity"),
      render: (row) => <AdminStatusBadge text={t(`severity.${row.severity}`)} tone={toneForSeverity(row.severity)} />,
    },
    {
      key: "message",
      header: t("table.findings.headers.message"),
      render: (row) => {
        const riskMeta = readRiskMetadata(row.metadata)
        const riskLine = formatRiskTuple([
          riskMeta?.riskLevel,
          riskMeta?.operationClass,
          riskMeta?.targetClass,
          riskMeta?.boundaryClass,
        ])
        return (
          <div className="max-w-[420px] space-y-1 text-xs text-[var(--muted)]">
            <div>{row.message}</div>
            {riskLine ? <div className="font-mono">{riskLine}</div> : null}
          </div>
        )
      },
    },
  ]

  const handleRescan = async () => {
    setFeedback(null)
    try {
      await mutate()
      setFeedback(t("feedback.refreshed"))
    } catch (refreshError) {
      setFeedback(refreshError instanceof Error ? refreshError.message : t("empty.failed"))
    }
  }

  const handleFindingAction = async (finding: LocalScanRun["findings"][number]) => {
    const action = finding.action
    if (!action) return
    setFeedback(null)
    setActioningId(finding.id)
    try {
      const result = await runScanReviewAction(action)
      setFeedback(result?.message ?? t("feedback.actionApplied"))
      await mutate()
    } catch (actionError) {
      setFeedback(actionError instanceof Error ? actionError.message : t("feedback.actionFailed"))
    } finally {
      setActioningId(null)
    }
  }

  const handleBatchFix = async () => {
    if (!actionableFindings.length) return
    setFeedback(null)
    setBatchRunning(true)
    try {
      const result = await runScanReviewActions(actionableFindings)
      setFeedback(
        result
          ? t("feedback.batchApplied", {
              applied: result.applied,
              failed: result.failed,
              skipped: result.skipped,
            })
          : t("feedback.actionApplied")
      )
      await mutate()
    } catch (actionError) {
      setFeedback(actionError instanceof Error ? actionError.message : t("feedback.actionFailed"))
    } finally {
      setBatchRunning(false)
    }
  }

  const renderFindingActionLabel = (action: LocalScanFindingAction) => {
    return t(`actions.${action.kind}`)
  }

  return (
    <>
      <AdminStatCards stats={stats} columns={4} />
      <AdminFilterBar
        searchPlaceholder={t("filters.searchPlaceholder")}
        onSearch={setSearchQuery}
        onFilterChange={(key, value) => {
          if (key === "severity") setSeverityFilter(value)
          if (key === "boundary") setBoundaryFilter(value)
          if (key === "operation") setOperationFilter(value)
        }}
        filters={[
          {
            key: "severity",
            label: t("filters.severity"),
            options: [
              { label: t("severity.error"), value: "error" },
              { label: t("severity.warn"), value: "warn" },
              { label: t("severity.info"), value: "info" },
            ],
          },
          {
            key: "boundary",
            label: t("filters.boundary"),
            options: [
              { label: t("boundary.hard_boundary"), value: "hard_boundary" },
              { label: t("boundary.soft_boundary"), value: "soft_boundary" },
              { label: t("boundary.none"), value: "none" },
            ],
          },
          {
            key: "operation",
            label: t("filters.operation"),
            options: [
              { label: t("operation.process_exec"), value: "process_exec" },
              { label: t("operation.filesystem_write"), value: "filesystem_write" },
              { label: t("operation.filesystem_read"), value: "filesystem_read" },
              { label: t("operation.network_read"), value: "network_read" },
              { label: t("operation.unknown"), value: "unknown" },
            ],
          },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleBatchFix()}
              disabled={!supported || batchRunning || actionableFindings.length === 0}
            >
              {batchRunning ? t("actions.fixingAll") : t("actions.fixAll")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => void handleRescan()} disabled={!supported || isValidating || batchRunning}>
              <RefreshCcw className="size-3.5" />
              {isValidating ? t("actions.rescanning") : t("actions.rescan")}
            </Button>
          </div>
        }
      />
      {feedback && <p className="text-xs text-[var(--muted)]" role="status">{feedback}</p>}
      {data && (
        <div className="grid gap-2 text-xs text-[var(--muted)] md:grid-cols-3">
          <div>{t("summary.target")}: {data.target_path}</div>
          <div>{t("summary.finishedAt")}: {formatDate(data.finished_at, locale)}</div>
          <div>{t("summary.findings")}: {data.summary.finding_count}</div>
        </div>
      )}
      <div className="space-y-6">
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">{t("table.documents.title")}</h3>
          <AdminDataTable
            columns={documentColumns}
            data={documents}
            emptyMessage={!supported ? t("empty.desktopOnly") : isLoading ? t("empty.loading") : error ? t("empty.failed") : t("empty.noDocuments")}
          />
        </section>
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">{t("table.findings.title")}</h3>
          <AdminDataTable
            columns={findingColumns}
            data={findings}
            emptyMessage={!supported ? t("empty.desktopOnly") : isLoading ? t("empty.loading") : error ? t("empty.failed") : t("empty.noFindings")}
            rowActions={hasFindingActions ? (row) => {
              if (!row.action) return null
              return (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleFindingAction(row)}
                  disabled={batchRunning || actioningId === row.id}
                >
                  {actioningId === row.id ? t("actions.running") : renderFindingActionLabel(row.action)}
                </Button>
              )
            } : undefined}
          />
        </section>
      </div>
    </>
  )
}
