"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { GitCompareArrows, ShieldCheck, Terminal } from "lucide-react"

import { Button } from "@/components/ui/shadcn/button"
import type { LocalFrameRouteOverlapReadiness } from "@/lib/api/admin-dashboard"
import {
  useGatewayLogs,
  useGatewayLogStats,
  type GatewayLogQuery,
} from "@/lib/swr/use-gateway-logs"
import {
  getFrameRouteOverlapReadinessWindow,
  isFrameRouteOverlapReadinessRuntime,
  useFrameRouteOverlapReadiness,
} from "@/lib/swr/use-runtime-readiness"

import { shortId } from "./logs-shared"
import { LogsDetailPanel } from "./logs-detail-panel"
import { LogsFilterBar, type LogsFilters } from "./logs-filter-bar"
import { LogsTable } from "./logs-table"

const INITIAL_FILTERS: LogsFilters = {
  model: "",
  statusCode: "all",
  cache: "all",
  errorCode: "",
  start: "",
  end: "",
  pageSize: "50",
}

type ReadinessStatus = "ready" | "collecting" | "unhealthy" | "loading" | "unavailable"

const DAY_MS = 24 * 60 * 60 * 1000

export function LogsClient() {
  const t = useTranslations("logs")
  const locale = useLocale()
  const [filters, setFilters] = useState<LogsFilters>(INITIAL_FILTERS)
  const [readinessWindow, setReadinessWindow] = useState(() =>
    getFrameRouteOverlapReadinessWindow()
  )
  const [desktopRuntime, setDesktopRuntime] = useState(false)
  const [cursor, setCursor] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    setDesktopRuntime(isFrameRouteOverlapReadinessRuntime())
  }, [])

  const query = useMemo<GatewayLogQuery>(() => {
    const next: GatewayLogQuery = {
      size: Number(filters.pageSize),
    }

    if (cursor) next.cursor = cursor
    if (filters.model.trim()) next.model = filters.model.trim()
    if (filters.errorCode.trim()) next.error_code = filters.errorCode.trim()
    if (filters.statusCode !== "all") next.status_code = Number(filters.statusCode)
    if (filters.cache === "hit") next.is_cached = true
    if (filters.cache === "miss") next.is_cached = false

    const startTime = toIsoString(filters.start)
    const endTime = toIsoString(filters.end)
    if (startTime) next.start_time = startTime
    if (endTime) next.end_time = endTime

    return next
  }, [filters, cursor])

  const { data, error, isLoading, isValidating, mutate } = useGatewayLogs(query, {
    keepPreviousData: true,
  })
  const { data: statsData, mutate: mutateStats } = useGatewayLogStats(query)
  const {
    data: readinessData,
    error: readinessError,
    isLoading: readinessLoading,
    isValidating: readinessValidating,
  } = useFrameRouteOverlapReadiness(readinessWindow, { enabled: desktopRuntime })

  const items = useMemo(() => data?.items ?? [], [data?.items])
  const effectiveSelectedId = selectedId && items.some((item) => item.id === selectedId)
    ? selectedId
    : (items[0]?.id ?? null)
  const selectedLog = items.find((item) => item.id === effectiveSelectedId) ?? null
  const activeFilterCount = useMemo(() => getActiveFilterCount(filters), [filters])

  const pageInfo = useMemo(() => {
    const pageSize = Number(filters.pageSize)
    const skip = cursor ? parseInt(cursor, 10) : 0
    const page = Math.floor(skip / pageSize) + 1
    const totalPages = statsData?.total ? Math.ceil(statsData.total / pageSize) : 1
    return { page, totalPages }
  }, [cursor, filters.pageSize, statsData?.total])

  return (
    <main className="-mb-[var(--shell-canvas-pb)] -mt-[var(--shell-canvas-pt)] -mx-[var(--shell-canvas-px)] flex h-[calc(100dvh-var(--shell-toolbar-h))] flex-col overflow-hidden bg-[var(--background)] font-mono text-[var(--ink-2)]">
      <header className="flex h-12 flex-none items-center justify-between border-b border-[var(--hairline)] bg-[var(--background)] px-4">
        <div className="flex items-center gap-3">
          <Terminal className="size-4 text-[var(--ok)]" />
          <span className="text-sm font-bold tracking-tighter text-[var(--ink)] uppercase">
            {t("header.title", { count: statsData?.total ?? items.length })}
          </span>
        </div>
        <div className="flex items-center gap-6 text-[10px] uppercase tracking-widest md:text-[11px]">
          <div className="flex items-center gap-2">
            <span className="text-[var(--ink-3)]">{t("header.filters")}</span>
            <span className={activeFilterCount > 0 ? "text-[var(--ok)]" : "text-[var(--ink-4)]"}>
              {activeFilterCount}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[var(--ink-3)]">{t("header.selected")}</span>
            <span className="text-[var(--ok)]">{selectedLog ? shortId(selectedLog.id) : t("header.none")}</span>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        <LogsFilterBar
          value={filters}
          activeCount={activeFilterCount}
          onChange={(next) => {
            setFilters(next)
            setCursor(null)
          }}
          onRefresh={() => {
            setReadinessWindow(getFrameRouteOverlapReadinessWindow())
            void Promise.all([mutate(), mutateStats()])
          }}
          onReset={() => {
            setFilters(INITIAL_FILTERS)
            setCursor(null)
            setSelectedId(null)
          }}
          refreshing={isValidating || (desktopRuntime && readinessValidating)}
        />

        {desktopRuntime ? (
          <FrameRouteOverlapReadinessBar
            data={readinessData}
            errorMessage={readinessError?.message}
            loading={readinessLoading || readinessValidating}
            locale={locale}
          />
        ) : null}

        {error ? (
          <div className="border-y border-[var(--danger-border)] bg-[var(--danger-soft)] px-4 py-2 text-[12px] text-[var(--danger)]">
            {t("error.loadFailed", { message: error.message || t("error.unknown") })}
          </div>
        ) : null}

        <div className="grid min-h-0 flex-1 xl:grid-cols-[minmax(0,1fr)_560px]">
          <section className="flex min-h-0 flex-col border-r border-[var(--hairline)]">
            <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar-brutalist">
              <LogsTable
                items={items}
                isLoading={isLoading}
                selectedId={effectiveSelectedId}
                onSelect={(log) => setSelectedId(log.id)}
              />
            </div>

            <footer className="flex h-10 flex-none items-center justify-between border-t border-[var(--hairline)] bg-[var(--background)] px-4">
              <div className="flex items-center gap-4 text-[11px]">
                <span className="text-[var(--ink-4)]">{t("footer.pageInfoLabel", pageInfo)}</span>
                <span className="text-[var(--ink-2)]">{t("footer.items", { count: items.length })}</span>
                <span className="text-[var(--ink-2)]">{t("footer.size", { size: filters.pageSize })}</span>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 rounded-none border border-[var(--hairline)] bg-transparent px-3 text-[10px] text-[var(--ink-2)] hover:bg-[var(--panel-bg-inset)] hover:text-[var(--ink)] disabled:opacity-30 uppercase font-mono shadow-none"
                  disabled={!data?.previous_page || isValidating}
                  onClick={() => setCursor(data?.previous_page ?? null)}
                >
                  {t("footer.prev")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 rounded-none border border-[var(--hairline)] bg-transparent px-3 text-[10px] text-[var(--ink-2)] hover:bg-[var(--panel-bg-inset)] hover:text-[var(--ink)] disabled:opacity-30 uppercase font-mono shadow-none"
                  disabled={!data?.next_page || isValidating}
                  onClick={() => setCursor(data?.next_page ?? null)}
                >
                  {t("footer.next")}
                </Button>
              </div>
            </footer>
          </section>

          <section className="min-h-0 bg-[var(--panel-bg-inset)]">
            <LogsDetailPanel log={selectedLog} locale={locale} />
          </section>
        </div>
      </div>

      <style jsx global>{`
        .custom-scrollbar-brutalist::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        .custom-scrollbar-brutalist::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar-brutalist::-webkit-scrollbar-thumb {
          background: var(--hairline-strong);
          border: 2px solid transparent;
          background-clip: content-box;
        }
        .custom-scrollbar-brutalist::-webkit-scrollbar-thumb:hover {
          background: var(--ink-4);
          background-clip: content-box;
        }
      `}</style>
    </main>
  )
}

function FrameRouteOverlapReadinessBar({
  data,
  errorMessage,
  loading,
  locale,
}: {
  data?: LocalFrameRouteOverlapReadiness
  errorMessage?: string
  loading: boolean
  locale: string
}) {
  const t = useTranslations("logs")
  const status = getReadinessStatus(data, loading, errorMessage)
  const statusLabel =
    status === "ready"
      ? t("readiness.status.ready")
      : status === "collecting"
        ? t("readiness.status.collecting")
        : status === "unhealthy"
          ? t("readiness.status.unhealthy")
          : status === "loading"
            ? t("readiness.status.loading")
            : t("readiness.status.unavailable")
  const statusClass =
    status === "ready"
      ? "text-[var(--ok)]"
      : status === "collecting"
        ? "text-[var(--warn)]"
        : status === "unhealthy"
          ? "text-[var(--danger)]"
          : "text-[var(--ink-3)]"

  return (
    <section className="flex flex-none flex-col gap-2 border-b border-[var(--hairline)] bg-[var(--panel-bg-inset)] px-4 py-3 text-[11px] uppercase tracking-widest text-[var(--ink-3)] xl:flex-row xl:items-center xl:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <GitCompareArrows className="size-4 flex-none text-[var(--ok)]" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-bold text-[var(--ink)]">{t("readiness.title")}</span>
            <span className={statusClass}>{statusLabel}</span>
          </div>
          {errorMessage ? (
            <div className="mt-1 normal-case tracking-normal text-[var(--danger)]">
              {t("readiness.error", { message: errorMessage })}
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <ReadinessMetric
          label={t("readiness.overlap")}
          value={formatRatio(data?.overlap_ratio, locale)}
        />
        <ReadinessMetric
          label={t("readiness.samples")}
          value={formatSamples(data, locale)}
        />
        <ReadinessMetric
          label={t("readiness.window")}
          value={formatDurationProgress(
            data?.observation_window_ms,
            data?.minimum_observation_window_ms,
            locale
          )}
        />
        <ReadinessMetric
          label={t("readiness.excluded")}
          value={formatNumber(data?.excluded_sample_count, locale)}
          icon={<ShieldCheck className="size-3.5" />}
        />
        <ReadinessMetric
          label={t("readiness.malformed")}
          value={formatMalformedPayloads(data, locale)}
        />
      </div>
    </section>
  )
}

function ReadinessMetric({
  label,
  value,
  icon,
}: {
  label: string
  value: string
  icon?: ReactNode
}) {
  return (
    <div className="flex min-w-[150px] items-center justify-between gap-3 border border-[var(--hairline)] bg-[var(--background)] px-3 py-2">
      <span className="min-w-0 truncate">{label}</span>
      <span
        className="flex min-w-0 max-w-[9rem] items-center gap-1.5 truncate whitespace-nowrap font-bold text-[var(--ink)]"
        title={value}
      >
        {icon}
        <span className="min-w-0 truncate">{value}</span>
      </span>
    </div>
  )
}

function getReadinessStatus(
  data: LocalFrameRouteOverlapReadiness | undefined,
  loading: boolean,
  errorMessage?: string
): ReadinessStatus {
  if (errorMessage) return "unavailable"
  if (loading && !data) return "loading"
  if (data && (!data.e3_payload_coverage_met || !data.e3_payload_health_met)) {
    return "unhealthy"
  }
  if (data?.threshold_met) return "ready"
  return "collecting"
}

function formatRatio(value: number | null | undefined, locale: string) {
  if (value === null || value === undefined) return "--"
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1,
    style: "percent",
  }).format(value)
}

function formatSamples(
  data: LocalFrameRouteOverlapReadiness | undefined,
  locale: string
) {
  if (!data) return "--"

  return `${formatNumber(data.matched_sample_count, locale)}/${formatNumber(
    data.eligible_sample_count,
    locale
  )}`
}

function formatMalformedPayloads(
  data: LocalFrameRouteOverlapReadiness | undefined,
  locale: string
) {
  if (!data) return "--"

  return `${formatNumber(data.missing_e3_payload_count, locale)}/${formatNumber(
    data.malformed_e3_payload_count,
    locale
  )}/${formatNumber(
    data.malformed_graph_payload_count,
    locale
  )}/${formatNumber(data.malformed_payload_count, locale)}`
}

function formatDuration(value: number | null | undefined, locale: string) {
  if (value === null || value === undefined) return "--"
  const days = value / DAY_MS
  const formattedDays = new Intl.NumberFormat(locale, {
    maximumFractionDigits: days >= 1 ? 1 : 2,
  }).format(days)

  return `${formattedDays}d`
}

function formatDurationProgress(
  value: number | null | undefined,
  minimum: number | null | undefined,
  locale: string
) {
  const formattedValue = formatDuration(value, locale)
  const formattedMinimum = formatDuration(minimum, locale)
  if (formattedValue === "--" || formattedMinimum === "--") return formattedValue

  return `${formattedValue}/${formattedMinimum}`
}

function formatNumber(value: number | null | undefined, locale: string) {
  if (value === null || value === undefined) return "--"
  return new Intl.NumberFormat(locale).format(value)
}

function getActiveFilterCount(filters: LogsFilters) {
  let count = 0

  if (filters.model.trim()) count += 1
  if (filters.statusCode !== "all") count += 1
  if (filters.cache !== "all") count += 1
  if (filters.errorCode.trim()) count += 1
  if (filters.start) count += 1
  if (filters.end) count += 1
  if (filters.pageSize !== "50") count += 1

  return count
}

function toIsoString(value: string) {
  if (!value) return undefined

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return undefined

  return date.toISOString()
}
