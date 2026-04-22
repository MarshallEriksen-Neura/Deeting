"use client"

import { ChevronRight, Database } from "lucide-react"

import { getNormalizedCacheSource } from "@/lib/gateway-log/cache-metrics"
import { cn } from "@/lib/utils"
import type { GatewayLogDTO } from "@/types/gateway_log"

interface LogsTableProps {
  items: GatewayLogDTO[]
  isLoading: boolean
  selectedId: string | null
  onSelect: (log: GatewayLogDTO) => void
}

export function LogsTable({ items, isLoading, selectedId, onSelect }: LogsTableProps) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 8 }).map((_, index) => (
          <div
            key={index}
            className="h-[146px] animate-pulse rounded-[22px] border border-[var(--hairline)] bg-[var(--panel-bg)]"
          />
        ))}
      </div>
    )
  }

  if (!items.length) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center rounded-[26px] border border-dashed border-[var(--hairline)] bg-[var(--panel-bg)] px-6 py-12 text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl border border-[var(--hairline)] bg-[var(--panel-bg-inset)] text-[var(--ink-3)]">
          <Database className="size-5" />
        </div>
        <p className="ws-pane-title mt-4">暂无日志数据</p>
        <p className="ws-caption mt-2 max-w-sm">
          当前筛选条件下没有命中的请求记录，调整模型、时间范围或缓存状态后再看。
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const isSelected = selectedId === item.id
        const tone = getStatusTone(item.status_code, item.error_code)
        const statusLabel = getStatusLabel(item.status_code, item.error_code)
        const cacheSource = getNormalizedCacheSource(item)

        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onSelect(item)}
            className={cn(
              "ws-rail ws-transition group w-full rounded-[22px] border px-4 py-4 text-left",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-border)] focus-visible:ring-offset-0",
              "active:translate-y-px",
              isSelected
                ? "border-[var(--accent-border)] bg-[linear-gradient(145deg,color-mix(in_srgb,var(--panel-bg)_88%,white_12%)_0%,color-mix(in_srgb,var(--panel-bg)_82%,var(--accent-soft)_18%)_100%)] shadow-[0_24px_56px_-34px_rgba(15,17,28,0.35)]"
                : "border-[var(--hairline)] bg-[var(--panel-bg)] hover:-translate-y-[1px] hover:border-[var(--hairline-strong)] hover:bg-[color:color-mix(in_srgb,var(--panel-bg)_92%,var(--panel-bg-inset)_8%)]"
            )}
            data-active={isSelected}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill label={`${statusLabel} · ${item.status_code}`} tone={tone} />
                  <span className="ws-num text-[11px] text-[var(--ink-3)]">{shortId(item.id)}</span>
                </div>

                <div className="mt-3 truncate text-[15px] font-semibold tracking-[-0.02em] text-[var(--ink)]">
                  {item.model}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[var(--ink-3)]">
                  <InlineChip label={item.error_code ?? (item.is_cached ? "缓存链路" : "实时请求")} />
                  {item.is_cached ? (
                    <InlineChip label={cacheSource === "provider_reported" ? "Provider Cache" : "Cache Hit"} />
                  ) : null}
                  {item.usage_source ? <InlineChip label={item.usage_source} /> : null}
                </div>
              </div>

              <div className="text-right">
                <div className="ws-num text-[15px] font-semibold text-[var(--ink)]">{item.duration_ms}ms</div>
                <div className="ws-caption mt-1">{formatRelativeTime(item.created_at)}</div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              <MetricTile label="成本" value={`$${formatCurrency(item.cost_user)}`} />
              <MetricTile label="Token" value={item.total_tokens.toLocaleString()} />
              <MetricTile label="TTFT" value={item.ttft_ms == null ? "-" : `${item.ttft_ms}ms`} />
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-[var(--hairline-subtle)] pt-3">
              <span className="ws-num text-[11px] text-[var(--ink-3)]">{formatDateTime(item.created_at)}</span>
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--accent-ink)]">
                查看详情
                <ChevronRight className="size-3.5" />
              </span>
            </div>
          </button>
        )
      })}
    </div>
  )
}

function StatusPill({ label, tone }: { label: string; tone: StatusTone }) {
  const toneClass =
    tone === "danger"
      ? "border-[var(--danger-border)] bg-[var(--danger-soft)] text-[var(--danger)]"
      : tone === "warn"
        ? "border-[var(--warn-border)] bg-[var(--warn-soft)] text-[var(--warn)]"
        : tone === "accent"
          ? "border-[var(--info-border)] bg-[var(--info-soft)] text-[var(--info)]"
          : "border-[var(--ok-border)] bg-[var(--ok-soft)] text-[var(--ok)]"

  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium", toneClass)}>
      <span className="ws-dot" data-tone={tone} />
      {label}
    </span>
  )
}

function InlineChip({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-[var(--hairline)] bg-[var(--panel-bg-inset)] px-2 py-1 text-[11px] text-[var(--ink-3)]">
      {label}
    </span>
  )
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[16px] border border-[var(--hairline)] bg-[var(--panel-bg-inset)]/68 px-3 py-2">
      <div className="ws-caption">{label}</div>
      <div className="ws-num mt-1 text-[13px] font-semibold text-[var(--ink)]">{value}</div>
    </div>
  )
}

function formatDateTime(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date)
}

function formatCurrency(value: number) {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  })
}

function shortId(value: string) {
  if (value.length <= 12) return value
  return `${value.slice(0, 8)}...${value.slice(-4)}`
}

type StatusTone = "ok" | "warn" | "danger" | "accent"

function getStatusTone(statusCode: number, errorCode?: string | null): StatusTone {
  if (statusCode <= 0 && errorCode) return "danger"
  if (statusCode >= 500) return "danger"
  if (statusCode >= 400) return "warn"
  if (statusCode >= 300) return "accent"
  return "ok"
}

function getStatusLabel(statusCode: number, errorCode?: string | null) {
  if (statusCode <= 0 && errorCode) return "执行失败"
  if (statusCode >= 500) return "上游错误"
  if (statusCode >= 400) return "请求异常"
  if (statusCode >= 300) return "重定向"
  return "请求成功"
}

function formatRelativeTime(iso: string) {
  const date = new Date(iso)
  const deltaMs = date.getTime() - Date.now()

  if (Number.isNaN(date.getTime())) return iso

  const minutes = Math.round(deltaMs / 60000)
  if (Math.abs(minutes) < 60) {
    return new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" }).format(minutes, "minute")
  }

  const hours = Math.round(deltaMs / 3_600_000)
  if (Math.abs(hours) < 24) {
    return new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" }).format(hours, "hour")
  }

  const days = Math.round(deltaMs / 86_400_000)
  return new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" }).format(days, "day")
}
