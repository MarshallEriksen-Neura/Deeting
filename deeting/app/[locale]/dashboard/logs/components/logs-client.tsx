"use client"

import { useMemo, useState } from "react"
import { Activity, AlertTriangle, Coins, Database } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"

import { GlassButton } from "@/components/ui/glass-button"
import { GlassStatCard } from "@/components/ui/glass-card"
import { useGatewayLogs, useGatewayLogStats, type GatewayLogQuery } from "@/lib/swr"

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
  pageSize: "20",
}

export function LogsClient() {
  const t = useTranslations("logs")
  const locale = useLocale()

  const [filters, setFilters] = useState<LogsFilters>(INITIAL_FILTERS)
  const [cursor, setCursor] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const query = useMemo<GatewayLogQuery>(() => {
    const next: GatewayLogQuery = {
      size: Number(filters.pageSize),
    }

    if (cursor) {
      next.cursor = cursor
    }

    if (filters.model.trim()) {
      next.model = filters.model.trim()
    }

    if (filters.errorCode.trim()) {
      next.error_code = filters.errorCode.trim()
    }

    if (filters.statusCode !== "all") {
      next.status_code = Number(filters.statusCode)
    }

    if (filters.cache === "hit") {
      next.is_cached = true
    } else if (filters.cache === "miss") {
      next.is_cached = false
    }

    const startTime = toIsoString(filters.start)
    const endTime = toIsoString(filters.end)

    if (startTime) {
      next.start_time = startTime
    }

    if (endTime) {
      next.end_time = endTime
    }

    return next
  }, [filters, cursor])

  const { data, error, isLoading, isValidating, mutate } = useGatewayLogs(query, {
    keepPreviousData: true,
  })
  const { data: statsData, mutate: mutateStats } = useGatewayLogStats(query)

  const items = useMemo(() => data?.items ?? [], [data?.items])
  const effectiveSelectedId =
    selectedId && items.some((item) => item.id === selectedId)
      ? selectedId
      : (items[0]?.id ?? null)
  const selectedLog = items.find((item) => item.id === effectiveSelectedId) ?? null

  const summary = useMemo(() => {
    const pageTotal = items.length
    const failed = items.filter((item) => isFailedRequest(item.status_code, item.error_code)).length
    const cacheHits = items.filter((item) => item.is_cached).length
    const total = statsData?.total ?? pageTotal
    const totalCost = statsData?.total_cost_user ?? items.reduce((acc, item) => acc + item.cost_user, 0)

    return {
      total,
      errorRate: statsData != null ? 100 - statsData.success_rate : total === 0 ? 0 : (failed / total) * 100,
      cacheHitRate:
        statsData != null ? statsData.cache_hit_rate : total === 0 ? 0 : (cacheHits / total) * 100,
      totalCost,
    }
  }, [items, statsData])

  const handleFiltersChange = (next: LogsFilters) => {
    setFilters(next)
    setCursor(null)
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <GlassStatCard
          label={t("summary.totalRequests")}
          value={new Intl.NumberFormat(locale).format(summary.total)}
          icon={<Database className="h-5 w-5" />}
          className="p-4"
        />
        <GlassStatCard
          label={t("summary.errorRate")}
          value={`${summary.errorRate.toFixed(1)}%`}
          icon={<AlertTriangle className="h-5 w-5" />}
          className="p-4"
        />
        <GlassStatCard
          label={t("summary.cacheHitRate")}
          value={`${summary.cacheHitRate.toFixed(1)}%`}
          icon={<Activity className="h-5 w-5" />}
          className="p-4"
        />
        <GlassStatCard
          label={t("summary.totalCost")}
          value={`$${formatCurrency(summary.totalCost)}`}
          icon={<Coins className="h-5 w-5" />}
          className="p-4"
        />
      </div>

      <LogsFilterBar
        value={filters}
        onChange={handleFiltersChange}
        onRefresh={() => {
          void Promise.all([mutate(), mutateStats()])
        }}
        refreshing={isValidating}
      />

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {t("error.loadFailed", { message: error.message || "unknown" })}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.8fr)_minmax(0,1.2fr)]">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
          <LogsTable
            items={items}
            isLoading={isLoading}
            selectedId={effectiveSelectedId}
            onSelect={(log) => setSelectedId(log.id)}
          />

          <div className="mt-4 flex flex-col gap-3 border-t border-[var(--border)] pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-[var(--muted)]">
              {t("pagination.pageInfo", {
                pageSize: filters.pageSize,
                count: String(items.length),
              })}
            </p>

            <div className="flex items-center gap-2">
              <GlassButton
                type="button"
                variant="secondary"
                size="sm"
                disabled={!data?.previous_page || isValidating}
                onClick={() => setCursor(data?.previous_page ?? null)}
              >
                {t("pagination.prev")}
              </GlassButton>
              <GlassButton
                type="button"
                variant="secondary"
                size="sm"
                disabled={!data?.next_page || isValidating}
                onClick={() => setCursor(data?.next_page ?? null)}
              >
                {t("pagination.next")}
              </GlassButton>
            </div>
          </div>
        </div>

        <LogsDetailPanel log={selectedLog} />
      </div>
    </div>
  )
}

function toIsoString(value: string) {
  if (!value) return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return undefined
  return date.toISOString()
}

function formatCurrency(value: number) {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  })
}

function isFailedRequest(statusCode: number, errorCode?: string | null) {
  return statusCode >= 400 || (statusCode <= 0 && Boolean(errorCode))
}
