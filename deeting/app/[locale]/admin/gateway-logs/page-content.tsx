"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import { Activity, Check } from "lucide-react"
import {
  AdminPageShell,
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
  const localErrors = filteredRows.filter((item) => item.status_code >= 400).length
  const localAvgLatency =
    localTotal > 0
      ? Math.round(filteredRows.reduce((sum, item) => sum + item.duration_ms, 0) / localTotal)
      : 0
  const localCacheHits = filteredRows.filter((item) => item.is_cached).length

  const stats: StatCardData[] = [
    { label: "Total Logs", value: statsData?.total ?? localTotal, color: "primary" },
    {
      label: "Error Rate",
      value:
        statsData != null
          ? `${(100 - statsData.success_rate).toFixed(1)}%`
          : `${localTotal > 0 ? ((localErrors / localTotal) * 100).toFixed(1) : 0}%`,
      color: (statsData ? 100 - statsData.success_rate : localErrors) > 0 ? "rose" : "emerald",
    },
    {
      label: "Avg Latency",
      value: `${localAvgLatency}ms`,
      color: "teal",
    },
    {
      label: "Cache Hits",
      value:
        statsData != null
          ? `${statsData.cache_hit_rate.toFixed(1)}%`
          : `${localTotal > 0 ? ((localCacheHits / localTotal) * 100).toFixed(1) : 0}%`,
      color: "amber",
    },
  ]

  const statusColor = (code: number) =>
    code < 300
      ? "text-emerald-400 bg-emerald-500/10"
      : code < 500
        ? "text-amber-400 bg-amber-500/10"
        : "text-rose-400 bg-rose-500/10"

  const columns: ColumnDef<GatewayLogItem>[] = [
    {
      key: "trace_id",
      header: "Trace ID",
      render: (row) => (
        <span className="font-mono text-[10px] text-[var(--muted)]">
          {row.trace_id ? `${row.trace_id.slice(0, 16)}...` : "—"}
        </span>
      ),
    },
    {
      key: "user_id",
      header: "User",
      sortable: true,
      render: (row) => <span className="font-mono text-xs">{shortId(row.user_id)}</span>,
    },
    {
      key: "api_key_id",
      header: "API Key",
      render: (row) => <span className="font-mono text-xs text-[var(--muted)]">{shortId(row.api_key_id)}</span>,
    },
    {
      key: "model",
      header: "Model",
      render: (row) => <span className="font-mono text-xs text-[var(--muted)]">{row.model}</span>,
    },
    {
      key: "status_code",
      header: "Status",
      sortable: true,
      render: (row) => (
        <span className={`inline-flex rounded px-1.5 py-0.5 font-mono text-xs font-medium ${statusColor(row.status_code)}`}>
          {row.status_code}
        </span>
      ),
    },
    {
      key: "duration_ms",
      header: "Duration",
      sortable: true,
      render: (row) => <span className="font-mono text-xs">{row.duration_ms}ms</span>,
    },
    {
      key: "ttft_ms",
      header: "TTFT",
      render: (row) => <span className="font-mono text-xs text-[var(--muted)]">{row.ttft_ms ? `${row.ttft_ms}ms` : "—"}</span>,
    },
    {
      key: "input_tokens",
      header: "Tokens",
      render: (row) => (
        <span className="font-mono text-[10px] text-[var(--muted)]">
          {row.input_tokens.toLocaleString()} / {row.output_tokens.toLocaleString()}
        </span>
      ),
    },
    {
      key: "cost_user",
      header: "Cost",
      align: "right",
      sortable: true,
      render: (row) => <span className="font-mono text-xs">${row.cost_user.toFixed(4)}</span>,
    },
    {
      key: "is_cached",
      header: "Cache",
      render: (row) =>
        row.is_cached ? <Check className="size-4 text-emerald-400" /> : <span className="text-[var(--muted)]">—</span>,
    },
    {
      key: "error_code",
      header: "Error",
      render: (row) =>
        row.error_code ? <span className="font-mono text-xs text-rose-400">{row.error_code}</span> : <span className="text-[var(--muted)]">—</span>,
    },
  ]

  return (
    <AdminPageShell title="Gateway Logs" description="API gateway request logs and analytics" icon={Activity}>
      <AdminStatCards stats={stats} columns={4} />
      <AdminFilterBar
        searchPlaceholder="Search by trace ID, user, model..."
        onSearch={setSearchQuery}
        onFilterChange={(key, value) => {
          if (key === "model") setModelFilter(value)
          if (key === "status") setStatusBucketFilter(value)
          if (key === "cached") setCachedFilter(value)
        }}
        filters={[
          { key: "model", label: "Model", options: [{ label: "GPT-4o", value: "gpt-4o" }, { label: "Claude 3 Opus", value: "claude-3-opus" }, { label: "GPT-4o Mini", value: "gpt-4o-mini" }, { label: "DeepSeek V3", value: "deepseek-v3" }] },
          { key: "status", label: "Status", options: [{ label: "2xx", value: "2xx" }, { label: "4xx", value: "4xx" }, { label: "5xx", value: "5xx" }] },
          { key: "cached", label: "Cached", options: [{ label: "Yes", value: "true" }, { label: "No", value: "false" }] },
        ]}
      />
      <AdminDataTable
        columns={columns}
        data={filteredRows}
        emptyMessage={isLoading ? "Loading logs..." : error ? "Failed to load logs" : "No logs found"}
        pageSize={15}
      />
    </AdminPageShell>
  )
}
