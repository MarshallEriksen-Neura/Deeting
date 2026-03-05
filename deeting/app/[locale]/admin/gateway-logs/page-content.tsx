"use client"

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import useSWR from "swr"
import { Check } from "lucide-react"
import {
  AdminStatCards,
  AdminDataTable,
  AdminFilterBar,
  type ColumnDef,
  type StatCardData,
} from "@/components/admin"
import {
  fetchAdminGatewayLogs,
  fetchAdminGatewayLogStats,
  type GatewayLogItem,
} from "@/lib/api/admin-dashboard"

function shortId(value?: string | null) {
  if (!value) return "—"
  return `${value.slice(0, 8)}...`
}

export function PageContent() {
  const t = useTranslations("admin.gatewayLogsPage")
  const locale = useLocale()
  const numberFormatter = new Intl.NumberFormat(locale)
  const percentageFormatter = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  const currencyFormatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  })
  const [searchQuery, setSearchQuery] = useState("")
  const [modelFilter, setModelFilter] = useState("")
  const [statusBucketFilter, setStatusBucketFilter] = useState("")
  const [cachedFilter, setCachedFilter] = useState("")

  const { data, error, isLoading } = useSWR(
    ["/api/v1/admin/gateway-logs", modelFilter, cachedFilter],
    () =>
      fetchAdminGatewayLogs({
        limit: 100,
        model: modelFilter || undefined,
        is_cached: cachedFilter ? cachedFilter === "true" : undefined,
      })
  )

  const { data: statsData } = useSWR(
    ["/api/v1/admin/gateway-logs/stats", modelFilter, cachedFilter],
    () =>
      fetchAdminGatewayLogStats({
        model: modelFilter || undefined,
        is_cached: cachedFilter ? cachedFilter === "true" : undefined,
      })
  )

  const allRows = useMemo(() => data?.items ?? [], [data?.items])

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return allRows.filter((row) => {
      if (statusBucketFilter === "2xx" && (row.status_code < 200 || row.status_code >= 300)) {
        return false
      }
      if (statusBucketFilter === "4xx" && (row.status_code < 400 || row.status_code >= 500)) {
        return false
      }
      if (statusBucketFilter === "5xx" && row.status_code < 500) {
        return false
      }
      if (!query) return true
      return [row.trace_id, row.user_id, row.api_key_id, row.model, row.error_code].some((value) =>
        String(value ?? "").toLowerCase().includes(query)
      )
    })
  }, [allRows, searchQuery, statusBucketFilter])

  const localTotal = filteredRows.length
  const localErrors = filteredRows.filter(isFailedRequest).length
  const localAvgLatency =
    localTotal > 0
      ? Math.round(filteredRows.reduce((sum, item) => sum + item.duration_ms, 0) / localTotal)
      : 0
  const localCacheHits = filteredRows.filter((item) => item.is_cached).length

  const stats: StatCardData[] = [
    { label: t("stats.totalLogs"), value: numberFormatter.format(statsData?.total ?? localTotal), color: "primary" },
    {
      label: t("stats.errorRate"),
      value:
        statsData != null
          ? `${percentageFormatter.format(100 - statsData.success_rate)}%`
          : `${percentageFormatter.format(localTotal > 0 ? (localErrors / localTotal) * 100 : 0)}%`,
      color: (statsData ? 100 - statsData.success_rate : localErrors) > 0 ? "rose" : "emerald",
    },
    {
      label: t("stats.avgLatency"),
      value: t("stats.ms", { value: numberFormatter.format(localAvgLatency) }),
      color: "teal",
    },
    {
      label: t("stats.cacheHits"),
      value:
        statsData != null
          ? `${percentageFormatter.format(statsData.cache_hit_rate)}%`
          : `${percentageFormatter.format(localTotal > 0 ? (localCacheHits / localTotal) * 100 : 0)}%`,
      color: "amber",
    },
  ]

  const statusColor = (code: number, errorCode?: string | null) =>
    code <= 0 && errorCode
      ? "text-rose-400 bg-rose-500/10"
      : code <= 0
        ? "text-slate-300 bg-slate-500/10"
      : code < 300
      ? "text-emerald-400 bg-emerald-500/10"
      : code < 500
        ? "text-amber-400 bg-amber-500/10"
        : "text-rose-400 bg-rose-500/10"

  const columns: ColumnDef<GatewayLogItem>[] = [
    {
      key: "trace_id",
      header: t("table.headers.traceId"),
      render: (row) => (
        <span className="font-mono text-[10px] text-[var(--muted)]">
          {row.trace_id ? `${row.trace_id.slice(0, 16)}...` : "—"}
        </span>
      ),
    },
    {
      key: "user_id",
      header: t("table.headers.user"),
      sortable: true,
      render: (row) => <span className="font-mono text-xs">{shortId(row.user_id)}</span>,
    },
    {
      key: "api_key_id",
      header: t("table.headers.apiKey"),
      render: (row) => <span className="font-mono text-xs text-[var(--muted)]">{shortId(row.api_key_id)}</span>,
    },
    {
      key: "model",
      header: t("table.headers.model"),
      render: (row) => <span className="font-mono text-xs text-[var(--muted)]">{row.model}</span>,
    },
    {
      key: "status_code",
      header: t("table.headers.status"),
      sortable: true,
      render: (row) => (
        <span
          className={`inline-flex rounded px-1.5 py-0.5 font-mono text-xs font-medium ${statusColor(
            row.status_code,
            row.error_code
          )}`}
        >
          {row.status_code}
        </span>
      ),
    },
    {
      key: "duration_ms",
      header: t("table.headers.duration"),
      sortable: true,
      render: (row) => <span className="font-mono text-xs">{t("stats.ms", { value: numberFormatter.format(row.duration_ms) })}</span>,
    },
    {
      key: "ttft_ms",
      header: t("table.headers.ttft"),
      render: (row) => (
        <span className="font-mono text-xs text-[var(--muted)]">
          {row.ttft_ms ? t("stats.ms", { value: numberFormatter.format(row.ttft_ms) }) : "—"}
        </span>
      ),
    },
    {
      key: "input_tokens",
      header: t("table.headers.tokens"),
      render: (row) => (
        <span className="font-mono text-[10px] text-[var(--muted)]">
          {numberFormatter.format(row.input_tokens)} / {numberFormatter.format(row.output_tokens)}
        </span>
      ),
    },
    {
      key: "cost_user",
      header: t("table.headers.cost"),
      align: "right",
      sortable: true,
      render: (row) => <span className="font-mono text-xs">{currencyFormatter.format(row.cost_user)}</span>,
    },
    {
      key: "is_cached",
      header: t("table.headers.cache"),
      render: (row) =>
        row.is_cached ? <Check className="size-4 text-emerald-400" /> : <span className="text-[var(--muted)]">—</span>,
    },
    {
      key: "error_code",
      header: t("table.headers.error"),
      render: (row) =>
        row.error_code ? <span className="font-mono text-xs text-rose-400">{row.error_code}</span> : <span className="text-[var(--muted)]">—</span>,
    },
  ]

  return (
    <>
      <AdminStatCards stats={stats} columns={4} />
      <AdminFilterBar
        searchPlaceholder={t("filters.searchPlaceholder")}
        onSearch={setSearchQuery}
        onFilterChange={(key, value) => {
          if (key === "model") setModelFilter(value)
          if (key === "status") setStatusBucketFilter(value)
          if (key === "cached") setCachedFilter(value)
        }}
        filters={[
          {
            key: "model",
            label: t("filters.model"),
            options: [
              { label: "GPT-4o", value: "gpt-4o" },
              { label: "Claude 3 Opus", value: "claude-3-opus" },
              { label: "GPT-4o Mini", value: "gpt-4o-mini" },
              { label: "DeepSeek V3", value: "deepseek-v3" },
            ],
          },
          {
            key: "status",
            label: t("filters.status"),
            options: [
              { label: t("statusBucket.2xx"), value: "2xx" },
              { label: t("statusBucket.4xx"), value: "4xx" },
              { label: t("statusBucket.5xx"), value: "5xx" },
            ],
          },
          {
            key: "cached",
            label: t("filters.cached"),
            options: [
              { label: t("cached.yes"), value: "true" },
              { label: t("cached.no"), value: "false" },
            ],
          },
        ]}
      />
      <AdminDataTable
        columns={columns}
        data={filteredRows}
        emptyMessage={
          isLoading
            ? t("empty.loading")
            : error
              ? t("empty.failed")
              : t("empty.noData")
        }
        pageSize={15}
      />
    </>
  )
}

function isFailedRequest(item: GatewayLogItem) {
  return item.status_code >= 400 || (item.status_code <= 0 && Boolean(item.error_code))
}
