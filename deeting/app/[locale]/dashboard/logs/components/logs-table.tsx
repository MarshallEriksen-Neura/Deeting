"use client"

import { ChevronRight, Database } from "lucide-react"

import { getNormalizedCacheSource } from "@/lib/gateway-log/cache-metrics"
import { cn } from "@/lib/utils"
import type { GatewayLogDTO } from "@/types/gateway_log"

import {
  formatCurrency,
  formatDateTime,
  formatRelativeTime,
  getStatusLabel,
  getStatusTone,
  shortId,
  type StatusTone,
} from "./logs-shared"

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
            className="h-[176px] animate-pulse rounded-[24px] border border-[var(--hairline)] bg-[var(--panel-bg-inset)]"
          />
        ))}
      </div>
    )
  }

  if (!items.length) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center rounded-[26px] border border-dashed border-[var(--hairline)] bg-[var(--panel-bg-inset)] px-6 py-12 text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl border border-[var(--hairline)] bg-[var(--panel-bg)] text-[var(--ink-3)]">
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
              "group w-full rounded-[24px] border bg-[var(--panel-bg)] px-4 py-4 text-left",
              "ws-transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-border)] focus-visible:ring-offset-0",
              "active:translate-y-px",
              isSelected
                ? "border-[var(--accent-border)] shadow-[var(--elev-floating)]"
                : "border-[var(--hairline)] hover:border-[var(--hairline-strong)] hover:bg-[var(--panel-bg-inset)]"
            )}
          >
            <div className="flex gap-4">
              <span className={cn("mt-1 w-1.5 shrink-0 rounded-full", getToneRailClass(tone))} />

              <div className="min-w-0 flex-1">
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
                    <div className="ws-num text-[17px] font-semibold text-[var(--ink)]">{item.duration_ms}ms</div>
                    <div className="ws-caption mt-1">{formatRelativeTime(item.created_at)}</div>
                  </div>
                </div>

                <div className="mt-4 grid gap-2 sm:grid-cols-3">
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
              </div>
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
          ? "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-ink)]"
          : "border-[var(--ok-border)] bg-[var(--ok-soft)] text-[var(--ok)]"

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium",
        toneClass
      )}
    >
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
    <div className="rounded-[18px] border border-[var(--hairline)] bg-[var(--panel-bg-inset)] px-3 py-2.5">
      <div className="ws-caption">{label}</div>
      <div className="ws-num mt-1 text-[13px] font-semibold text-[var(--ink)]">{value}</div>
    </div>
  )
}

function getToneRailClass(tone: StatusTone) {
  return tone === "danger"
    ? "bg-[var(--danger)]"
    : tone === "warn"
      ? "bg-[var(--warn)]"
      : tone === "accent"
        ? "bg-[var(--accent-strong)]"
        : "bg-[var(--ok)]"
}
