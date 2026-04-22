"use client"

import { type ReactNode, useMemo, useState } from "react"
import { Activity, AlertTriangle, Coins, Database } from "lucide-react"

import { Container } from "@/components/ui/common/container"
import { Card, CardContent } from "@/components/ui/shadcn/card"
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
    <Container as="main" gutter="md" size="full" className="py-6 md:py-8 !mx-0 !max-w-none">
      <div className="space-y-6">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-[color:var(--ios-pill-border)] bg-[color:var(--ios-pill-muted)] px-3 py-1 text-xs text-muted-foreground">
            <Database className="size-3.5" />
            桌面端本地请求日志
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">日志</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              查看桌面端本地网关请求、缓存命中、成本与错误详情。
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard label="总请求数" value={summary.total.toLocaleString()} icon={<Database className="size-5" />} />
          <SummaryCard label="错误率" value={`${summary.errorRate.toFixed(1)}%`} icon={<AlertTriangle className="size-5" />} />
          <SummaryCard label="缓存命中率" value={`${summary.cacheHitRate.toFixed(1)}%`} icon={<Activity className="size-5" />} />
          <SummaryCard label="总成本" value={`$${formatCurrency(summary.totalCost)}`} icon={<Coins className="size-5" />} />
        </div>

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
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-700 dark:text-red-300">
            加载日志失败：{error.message || "unknown"}
          </div>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.8fr)_minmax(0,1.2fr)]">
          <div className="rounded-2xl border border-border bg-card p-4">
            <LogsTable items={items} isLoading={isLoading} selectedId={effectiveSelectedId} onSelect={(log) => setSelectedId(log.id)} />

            <div className="mt-4 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">当前页 {items.length} 条，每页 {filters.pageSize} 条</p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={!data?.previous_page || isValidating} onClick={() => setCursor(data?.previous_page ?? null)}>
                  上一页
                </Button>
                <Button variant="outline" size="sm" disabled={!data?.next_page || isValidating} onClick={() => setCursor(data?.next_page ?? null)}>
                  下一页
                </Button>
              </div>
            </div>
          </div>

          <LogsDetailPanel log={selectedLog} />
        </div>
      </div>
    </Container>
  )
}

function SummaryCard({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <div className="text-sm text-muted-foreground">{label}</div>
          <div className="mt-1 text-2xl font-semibold">{value}</div>
        </div>
        <div className="text-muted-foreground">{icon}</div>
      </CardContent>
    </Card>
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

