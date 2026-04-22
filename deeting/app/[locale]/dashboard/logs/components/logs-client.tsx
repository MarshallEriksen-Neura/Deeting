"use client"

import { type ReactNode, useMemo, useState } from "react"
import { Activity, AlertTriangle, Coins, Database } from "lucide-react"

import { Button } from "@/components/ui/shadcn/button"
import { computePreferredDesktopCacheRate } from "@/lib/gateway-log/cache-metrics"
import { useGatewayLogs, useGatewayLogStats, type GatewayLogQuery } from "@/lib/swr/use-gateway-logs"

import { formatCurrency, isFailedRequest, shortId } from "./logs-shared"
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
  const activeFilterCount = useMemo(() => getActiveFilterCount(filters), [filters])

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
      <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-4 px-4 pb-4 pt-4 md:px-5 md:pb-5">
        <section className="rounded-[28px] border border-[var(--hairline)] bg-[var(--panel-bg)] p-4 shadow-[var(--elev-floating)] md:p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="min-w-0">
              <span className="inline-flex items-center gap-2 rounded-full border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 py-1 text-[11px] text-[var(--accent-ink)]">
                <Database className="size-3.5" />
                Gateway Console
              </span>
              <div className="mt-4 font-[var(--font-display)] text-[26px] font-semibold tracking-[-0.05em] text-[var(--ink)] md:text-[30px]">
                日志工作台
              </div>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-2)]">
                把本地网关请求整理成一块观测台：左侧负责筛选与样本列表，右侧聚焦单条请求的链路、token、成本和原始载荷。
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:min-w-[360px]">
              <HeaderMeta
                label="活动筛选"
                value={activeFilterCount === 0 ? "全部流量" : `${activeFilterCount} 个条件`}
              />
              <HeaderMeta
                label="当前选中"
                value={selectedLog ? shortId(selectedLog.id) : "等待选择"}
              />
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard
              label="请求总量"
              value={summary.total.toLocaleString()}
              note={`当前页 ${items.length} 条`}
              icon={<Database className="size-4" />}
            />
            <SummaryCard
              label="错误率"
              value={`${summary.errorRate.toFixed(1)}%`}
              note="4xx / 5xx / 执行失败"
              icon={<AlertTriangle className="size-4" />}
              tone="danger"
            />
            <SummaryCard
              label="缓存命中"
              value={`${summary.cacheHitRate.toFixed(1)}%`}
              note="桌面缓存优先口径"
              icon={<Activity className="size-4" />}
              tone="info"
            />
            <SummaryCard
              label="总成本"
              value={`$${formatCurrency(summary.totalCost)}`}
              note="当前筛选累计"
              icon={<Coins className="size-4" />}
              tone="accent"
            />
          </div>
        </section>

        <div className="grid min-h-0 gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(380px,0.95fr)]">
          <section className="flex min-h-0 flex-col rounded-[28px] border border-[var(--hairline)] bg-[var(--panel-bg)] shadow-[var(--elev-floating)]">
            <LogsFilterBar
              value={filters}
              activeCount={activeFilterCount}
              onChange={(next) => {
                setFilters(next)
                setCursor(null)
              }}
              onRefresh={() => {
                void Promise.all([mutate(), mutateStats()])
              }}
              onReset={() => {
                setFilters(INITIAL_FILTERS)
                setCursor(null)
                setSelectedId(null)
              }}
              refreshing={isValidating}
            />

            {error ? (
              <section className="mx-4 mt-4 rounded-[20px] border border-[var(--danger-border)] bg-[var(--danger-soft)] px-4 py-3 text-[var(--danger)]">
                <div className="flex items-start gap-2 text-sm">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <div>
                    <div className="font-medium">日志加载失败</div>
                    <p className="mt-1 text-[13px] leading-5">{error.message || "unknown"}</p>
                  </div>
                </div>
              </section>
            ) : null}

            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-4 custom-scrollbar">
              <LogsTable
                items={items}
                isLoading={isLoading}
                selectedId={effectiveSelectedId}
                onSelect={(log) => setSelectedId(log.id)}
              />
            </div>

            <footer className="flex flex-none flex-col gap-3 border-t border-[var(--hairline)] bg-[var(--panel-bg-inset)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <p className="ws-caption">
                  当前页 <span className="ws-num font-semibold text-[var(--ink)]">{items.length}</span> 条
                </p>
                <p className="ws-caption">
                  每页 <span className="ws-num font-semibold text-[var(--ink)]">{filters.pageSize}</span> 条
                </p>
                {selectedLog ? (
                  <p className="ws-caption">
                    已选日志 <span className="ws-num font-semibold text-[var(--ink)]">{shortId(selectedLog.id)}</span>
                  </p>
                ) : null}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 rounded-[12px] border-[var(--hairline)] bg-[var(--panel-bg)] text-[var(--ink-2)] shadow-none"
                  disabled={!data?.previous_page || isValidating}
                  onClick={() => setCursor(data?.previous_page ?? null)}
                >
                  上一页
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 rounded-[12px] border-[var(--hairline)] bg-[var(--panel-bg)] text-[var(--ink-2)] shadow-none"
                  disabled={!data?.next_page || isValidating}
                  onClick={() => setCursor(data?.next_page ?? null)}
                >
                  下一页
                </Button>
              </div>
            </footer>
          </section>

          <section className="min-h-0 rounded-[28px] border border-[var(--hairline)] bg-[var(--panel-bg)] shadow-[var(--elev-floating)]">
            <LogsDetailPanel log={selectedLog} />
          </section>
        </div>
      </div>
    </main>
  )
}

function HeaderMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[20px] border border-[var(--hairline)] bg-[var(--panel-bg-inset)] px-4 py-3">
      <div className="ws-meta">{label}</div>
      <div className="mt-2 text-sm font-medium text-[var(--ink)]">{value}</div>
    </div>
  )
}

function SummaryCard({
  label,
  value,
  note,
  icon,
  tone = "default",
}: {
  label: string
  value: string
  note: string
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
    <div className="rounded-[22px] border border-[var(--hairline)] bg-[var(--panel-bg-inset)] px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="ws-meta">{label}</div>
          <div className="ws-num mt-3 text-[20px] font-semibold text-[var(--ink)]">{value}</div>
        </div>
        <div className={`flex size-9 shrink-0 items-center justify-center rounded-2xl border ${toneClass}`}>
          {icon}
        </div>
      </div>
      <p className="mt-3 text-[12px] leading-5 text-[var(--ink-3)]">{note}</p>
    </div>
  )
}

function getActiveFilterCount(filters: LogsFilters) {
  let count = 0

  if (filters.model.trim()) count += 1
  if (filters.statusCode !== "all") count += 1
  if (filters.cache !== "all") count += 1
  if (filters.errorCode.trim()) count += 1
  if (filters.start) count += 1
  if (filters.end) count += 1
  if (filters.pageSize !== INITIAL_FILTERS.pageSize) count += 1

  return count
}

function toIsoString(value: string) {
  if (!value) return undefined

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return undefined

  return date.toISOString()
}
