"use client"

import { type ReactNode, useMemo, useState } from "react"
import { Activity, AlertTriangle, Coins, Database } from "lucide-react"

import { Button } from "@/components/ui/shadcn/button"
import { computePreferredDesktopCacheRate } from "@/lib/gateway-log/cache-metrics"
import { useGatewayLogs, useGatewayLogStats, type GatewayLogQuery } from "@/lib/swr/use-gateway-logs"

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
  const [filters, setFilters] = useState<LogsFilters>(INITIAL_FILTERS)
  const [cursor, setCursor] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

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

  const items = useMemo(() => data?.items ?? [], [data?.items])
  const effectiveSelectedId = selectedId && items.some((item) => item.id === selectedId)
    ? selectedId
    : (items[0]?.id ?? null)
  const selectedLog = items.find((item) => item.id === effectiveSelectedId) ?? null

  const summary = useMemo(() => {
    const pageTotal = items.length
    const failed = items.filter((item) => isFailedRequest(item.status_code, item.error_code)).length
    const total = statsData?.total ?? pageTotal
    const totalCost = statsData?.total_cost_user ?? items.reduce((acc, item) => acc + item.cost_user, 0)
    const cacheHitRate = computePreferredDesktopCacheRate(items, statsData?.cache_hit_rate)

    return {
      total,
      errorRate: statsData != null ? 100 - statsData.success_rate : total === 0 ? 0 : (failed / total) * 100,
      cacheHitRate,
      totalCost,
    }
  }, [items, statsData])

  return (
    <main className="-mb-[var(--shell-canvas-pb)] -mt-[var(--shell-canvas-pt)] -mx-[var(--shell-canvas-px)] flex h-[calc(100dvh-var(--shell-toolbar-h))] flex-col overflow-hidden bg-[var(--window-bg)]">
      <header className="flex h-14 flex-none items-center justify-between gap-4 border-b border-[var(--hairline)] bg-[var(--panel-bg-inset)]/34 px-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-2xl border border-[var(--hairline)] bg-[var(--panel-bg)] text-[var(--accent-strong)] shadow-[var(--elev-inset-hi)]">
            <Database className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="ws-view-title">日志</div>
            <p className="ws-caption mt-0.5 truncate">本地网关请求列表与详情工作台</p>
          </div>
        </div>

        <div className="hidden min-w-0 flex-wrap items-center justify-end gap-2 xl:flex">
          <ToolbarStat label="请求总数" value={summary.total.toLocaleString()} icon={<Database className="size-3.5" />} />
          <ToolbarStat label="错误率" value={`${summary.errorRate.toFixed(1)}%`} icon={<AlertTriangle className="size-3.5" />} tone="danger" />
          <ToolbarStat label="缓存命中" value={`${summary.cacheHitRate.toFixed(1)}%`} icon={<Activity className="size-3.5" />} tone="info" />
          <ToolbarStat label="总成本" value={`$${formatCurrency(summary.totalCost)}`} icon={<Coins className="size-3.5" />} tone="accent" />
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1.08fr)_minmax(0,0.92fr)] lg:grid-cols-[minmax(0,1.08fr)_minmax(360px,0.92fr)] lg:grid-rows-1">
        <section className="flex min-h-0 flex-col border-b border-[var(--hairline)] bg-[var(--panel-bg-inset)]/20 lg:border-b-0 lg:border-r">
          <LogsFilterBar
            value={filters}
            onChange={(next) => {
              setFilters(next)
              setCursor(null)
            }}
            onRefresh={() => {
              void Promise.all([mutate(), mutateStats()])
            }}
            refreshing={isValidating}
          />

          {error ? (
            <div className="mx-4 mt-4 flex items-start gap-2 rounded-[16px] border border-[var(--danger-border)] bg-[linear-gradient(135deg,color-mix(in_srgb,var(--panel-bg)_88%,white_12%)_0%,color-mix(in_srgb,var(--panel-bg)_82%,var(--danger-soft)_18%)_100%)] px-3 py-2.5 text-[12px] text-[var(--danger)]">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span className="leading-5">加载日志失败：{error.message || "unknown"}</span>
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-3 md:px-4 custom-scrollbar">
            <LogsTable
              items={items}
              isLoading={isLoading}
              selectedId={effectiveSelectedId}
              onSelect={(log) => setSelectedId(log.id)}
            />
          </div>

          <footer className="flex flex-none flex-col gap-3 border-t border-[var(--hairline)] bg-[var(--panel-bg)]/92 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <p className="ws-caption">
                当前页 <span className="ws-num font-semibold text-[var(--ink)]">{items.length}</span> 条
              </p>
              <p className="ws-caption">
                每页 <span className="ws-num font-semibold text-[var(--ink)]">{filters.pageSize}</span> 条
              </p>
              {selectedLog ? (
                <p className="ws-caption">
                  已选日志 <span className="ws-num font-semibold text-[var(--ink)]">{selectedLog.id.slice(0, 8)}</span>
                </p>
              ) : null}
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="border-[var(--hairline)] bg-[var(--panel-bg)] text-[var(--ink-2)] shadow-none"
                disabled={!data?.previous_page || isValidating}
                onClick={() => setCursor(data?.previous_page ?? null)}
              >
                上一页
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="border-[var(--hairline)] bg-[var(--panel-bg)] text-[var(--ink-2)] shadow-none"
                disabled={!data?.next_page || isValidating}
                onClick={() => setCursor(data?.next_page ?? null)}
              >
                下一页
              </Button>
            </div>
          </footer>
        </section>

        <section className="min-h-0 bg-[var(--panel-bg)]">
          <LogsDetailPanel log={selectedLog} />
        </section>
      </div>
    </main>
  )
}

function ToolbarStat({
  label,
  value,
  icon,
  tone = "default",
}: {
  label: string
  value: string
  icon: ReactNode
  tone?: "default" | "danger" | "info" | "accent"
}) {
  const toneClass =
    tone === "danger"
      ? "border-[var(--danger-border)] bg-[var(--danger-soft)] text-[var(--danger)]"
      : tone === "info"
        ? "border-[var(--info-border)] bg-[var(--info-soft)] text-[var(--info)]"
        : tone === "accent"
          ? "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-ink)]"
          : "border-[var(--hairline)] bg-[var(--panel-bg)] text-[var(--ink-2)]"

  return (
    <div className={`flex min-w-[118px] items-center gap-3 rounded-full border px-3 py-2 ${toneClass}`}>
      <div className="shrink-0">{icon}</div>
      <div className="min-w-0">
        <div className="ws-caption text-current/75">{label}</div>
        <div className="ws-num mt-0.5 truncate text-[13px] font-semibold text-[var(--ink)]">{value}</div>
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

