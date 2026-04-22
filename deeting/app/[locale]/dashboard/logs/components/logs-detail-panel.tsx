"use client"

import { type ReactNode, useMemo, useState } from "react"
import { AlertTriangle, ArrowRight, Clock3, Coins, Copy, Database, Layers3, Workflow } from "lucide-react"

import { Button } from "@/components/ui/shadcn/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/shadcn/tabs"
import {
  getNormalizedCacheSource,
  getReportedCacheReadTokens,
} from "@/lib/gateway-log/cache-metrics"
import { cn } from "@/lib/utils"
import type { GatewayLogDTO } from "@/types/gateway_log"

interface LogsDetailPanelProps {
  log: GatewayLogDTO | null
}

export function LogsDetailPanel({ log }: LogsDetailPanelProps) {
  const [copied, setCopied] = useState(false)
  const meta = useMemo(
    () => (log?.meta && typeof log.meta === "object" ? (log.meta as Record<string, unknown>) : null),
    [log]
  )
  const cacheReadTokens = log ? getReportedCacheReadTokens(log) : null
  const cacheWriteTokens = log?.cache_write_input_tokens ?? null
  const cacheSource = log ? getNormalizedCacheSource(log) : "unknown"
  const requestPayload = meta?.request_payload ?? null
  const upstreamRequest = meta?.upstream_request ?? null
  const tone = log ? getStatusTone(log.status_code, log.error_code) : "accent"
  const statusLabel = log ? getStatusLabel(log.status_code, log.error_code) : ""

  async function handleCopy() {
    if (!log || typeof navigator === "undefined" || !navigator.clipboard?.writeText) return

    await navigator.clipboard.writeText(
      JSON.stringify(
        {
          id: log.id,
          model: log.model,
          status_code: log.status_code,
          duration_ms: log.duration_ms,
          ttft_ms: log.ttft_ms,
          input_tokens: log.input_tokens,
          output_tokens: log.output_tokens,
          total_tokens: log.total_tokens,
          cost_user: log.cost_user,
          cost_upstream: log.cost_upstream,
          is_cached: log.is_cached,
          error_code: log.error_code,
          meta: log.meta,
          created_at: log.created_at,
        },
        null,
        2,
      ),
    )
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--panel-bg)]">
      <header className="flex h-14 flex-none items-center justify-between gap-3 border-b border-[var(--hairline)] px-4">
        <div className="min-w-0">
          <div className="ws-view-title">日志详情</div>
          <p className="ws-caption mt-0.5 truncate">
            {log ? `请求 ID ${log.id}` : "从左侧选择一条日志查看完整信息"}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="border-[var(--hairline)] bg-[var(--panel-bg)] text-[var(--ink-2)] shadow-none"
          onClick={() => void handleCopy()}
          disabled={!log}
        >
          <Copy className="size-4" />
          {copied ? "已复制" : "复制 JSON"}
        </Button>
      </header>

      {!log ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6">
          <div className="w-full max-w-md rounded-[26px] border border-dashed border-[var(--hairline)] bg-[var(--panel-bg-inset)]/42 px-6 py-10 text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-2xl border border-[var(--hairline)] bg-[var(--panel-bg)] text-[var(--ink-3)]">
              <Workflow className="size-5" />
            </div>
            <p className="ws-pane-title mt-4">选择一条日志开始检查</p>
            <p className="ws-caption mt-2">
              右侧会展示请求链路、token 与成本、错误信息，以及完整的请求载荷。
            </p>
          </div>
        </div>
      ) : (
        <Tabs defaultValue="overview" className="flex min-h-0 flex-1 flex-col gap-0">
          <div className="flex flex-none flex-col gap-4 border-b border-[var(--hairline)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--panel-bg)_94%,white_6%)_0%,var(--panel-bg)_100%)] px-4 py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge label={`${statusLabel} · ${log.status_code}`} tone={tone} />
                  {log.is_cached ? <SoftChip label="Cache Hit" /> : null}
                </div>
                <div className="mt-3 ws-num text-[24px] font-semibold tracking-[-0.04em] text-[var(--ink)]">
                  {shortId(log.id)}
                </div>
                <p className="mt-1 truncate text-sm text-[var(--ink-3)]">{log.model}</p>
              </div>

              <div className="text-right">
                <div className="ws-num text-[18px] font-semibold text-[var(--ink)]">{log.duration_ms}ms</div>
                <div className="ws-caption mt-1">{formatRelativeTime(log.created_at)}</div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Fact label="模型" value={log.model} />
              <Fact label="缓存来源" value={cacheSource} />
              <Fact label="创建时间" value={formatDateTime(log.created_at)} />
              <Fact label="错误码" value={log.error_code ?? "-"} />
              <Fact label="Preset" value={log.preset_id ?? "直接调用"} />
              <Fact label="Usage" value={log.usage_source ?? "-"} />
            </div>

            <div className="rounded-[18px] border border-[var(--hairline)] bg-[var(--panel-bg-inset)]/72 px-3 py-3">
              <div className="ws-meta mb-2">请求链路</div>
              <div className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--ink-2)]">
                <RouteNode label="Client" />
                <ArrowRight className="size-3.5 text-[var(--ink-4)]" />
                <RouteNode label="Gateway" />
                <ArrowRight className="size-3.5 text-[var(--ink-4)]" />
                <RouteNode label={log.is_cached ? "Cache" : "Upstream"} />
                <ArrowRight className="size-3.5 text-[var(--ink-4)]" />
                <RouteNode label={log.error_code ? `Error · ${log.error_code}` : "Response"} tone={tone} />
              </div>
            </div>

            <TabsList className="h-auto w-full justify-start gap-1 rounded-[16px] border border-[var(--hairline)] bg-[var(--panel-bg-inset)] p-1">
              <TabsTrigger
                value="overview"
                className="h-8 rounded-[12px] px-3 text-[12px] data-[state=active]:border-[var(--hairline)] data-[state=active]:bg-[var(--panel-bg)] data-[state=active]:text-[var(--ink)]"
              >
                概览
              </TabsTrigger>
              <TabsTrigger
                value="request"
                className="h-8 rounded-[12px] px-3 text-[12px] data-[state=active]:border-[var(--hairline)] data-[state=active]:bg-[var(--panel-bg)] data-[state=active]:text-[var(--ink)]"
              >
                请求
              </TabsTrigger>
              <TabsTrigger
                value="upstream"
                className="h-8 rounded-[12px] px-3 text-[12px] data-[state=active]:border-[var(--hairline)] data-[state=active]:bg-[var(--panel-bg)] data-[state=active]:text-[var(--ink)]"
              >
                上游
              </TabsTrigger>
              <TabsTrigger
                value="raw"
                className="h-8 rounded-[12px] px-3 text-[12px] data-[state=active]:border-[var(--hairline)] data-[state=active]:bg-[var(--panel-bg)] data-[state=active]:text-[var(--ink)]"
              >
                原始
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 custom-scrollbar">
            <TabsContent value="overview" className="space-y-4">
              <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <OverviewMetric icon={<Clock3 className="size-4" />} label="TTFT" value={log.ttft_ms == null ? "-" : `${log.ttft_ms}ms`} />
                <OverviewMetric icon={<Layers3 className="size-4" />} label="Token 总量" value={log.total_tokens.toLocaleString()} />
                <OverviewMetric icon={<Database className="size-4" />} label="缓存状态" value={log.is_cached ? "命中" : "未命中"} />
                <OverviewMetric icon={<Coins className="size-4" />} label="用户成本" value={`$${formatCurrency(log.cost_user)}`} />
              </section>

              <div className="grid gap-4 xl:grid-cols-2">
                <InfoSection title="Token 消耗">
                  <KeyValue label="输入" value={log.input_tokens.toLocaleString()} />
                  <KeyValue label="输出" value={log.output_tokens.toLocaleString()} />
                  <KeyValue label="总计" value={log.total_tokens.toLocaleString()} strong />
                  <KeyValue label="缓存读取" value={cacheReadTokens == null ? "-" : cacheReadTokens.toLocaleString()} />
                  <KeyValue label="缓存写入" value={cacheWriteTokens == null ? "-" : cacheWriteTokens.toLocaleString()} />
                </InfoSection>

                <InfoSection title="成本与缓存">
                  <KeyValue label="用户成本" value={`$${formatCurrency(log.cost_user)}`} />
                  <KeyValue label="上游成本" value={`$${formatCurrency(log.cost_upstream)}`} />
                  <KeyValue label="缓存来源" value={cacheSource} />
                  <KeyValue label="状态码" value={String(log.status_code)} strong />
                </InfoSection>
              </div>

              {log.error_code ? (
                <div className="rounded-[20px] border border-[var(--danger-border)] bg-[var(--danger-soft)] px-4 py-4 text-[var(--danger)]">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <AlertTriangle className="size-4" />
                    当前请求包含错误信息
                  </div>
                  <p className="mt-2 text-sm">{log.error_code}</p>
                </div>
              ) : null}

              <section className="grid gap-3 md:grid-cols-2">
                <DetailCard label="Request ID" value={log.id} />
                <DetailCard label="用户 ID" value={log.user_id ?? "匿名"} />
                <DetailCard label="Preset ID" value={log.preset_id ?? "直接调用"} />
                <DetailCard label="创建时间" value={formatDateTime(log.created_at)} />
              </section>
            </TabsContent>

            <TabsContent value="request" className="space-y-4">
              <JsonSurface title="网关请求载荷" value={requestPayload} emptyText="当前日志没有记录 request_payload。" />
            </TabsContent>

            <TabsContent value="upstream" className="space-y-4">
              <JsonSurface title="上游请求" value={upstreamRequest} emptyText="当前日志没有记录 upstream_request。" />
            </TabsContent>

            <TabsContent value="raw" className="space-y-4">
              <JsonSurface title="原始元数据" value={meta} emptyText="当前日志没有额外 meta 信息。" />
            </TabsContent>
          </div>
        </Tabs>
      )}
    </div>
  )
}

function StatusBadge({ label, tone }: { label: string; tone: StatusTone }) {
  const toneClass =
    tone === "danger"
      ? "border-[var(--danger-border)] bg-[var(--danger-soft)] text-[var(--danger)]"
      : tone === "warn"
        ? "border-[var(--warn-border)] bg-[var(--warn-soft)] text-[var(--warn)]"
        : tone === "accent"
          ? "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-ink)]"
          : "border-[var(--ok-border)] bg-[var(--ok-soft)] text-[var(--ok)]"

  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium", toneClass)}>
      <span className="ws-dot" data-tone={tone} />
      {label}
    </span>
  )
}

function SoftChip({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-[var(--hairline)] bg-[var(--panel-bg)] px-2 py-1 text-[11px] text-[var(--ink-3)]">
      {label}
    </span>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[18px] border border-[var(--hairline)] bg-[var(--panel-bg)] px-3 py-3">
      <div className="ws-meta">{label}</div>
      <div className="mt-2 break-all text-sm text-[var(--ink)]">{value}</div>
    </div>
  )
}

function RouteNode({ label, tone = "accent" }: { label: string; tone?: StatusTone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px]",
        tone === "danger"
          ? "border-[var(--danger-border)] bg-[var(--danger-soft)] text-[var(--danger)]"
          : tone === "warn"
            ? "border-[var(--warn-border)] bg-[var(--warn-soft)] text-[var(--warn)]"
            : tone === "accent"
              ? "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-ink)]"
              : "border-[var(--ok-border)] bg-[var(--ok-soft)] text-[var(--ok)]"
      )}
    >
      {label}
    </span>
  )
}

function OverviewMetric({
  icon,
  label,
  value,
}: {
  icon: ReactNode
  label: string
  value: string
}) {
  return (
    <div className="rounded-[20px] border border-[var(--hairline)] bg-[var(--panel-bg-inset)]/60 px-4 py-3">
      <div className="flex items-center gap-2 text-[var(--ink-3)]">
        {icon}
        <span className="ws-caption">{label}</span>
      </div>
      <div className="ws-num mt-3 text-[17px] font-semibold text-[var(--ink)]">{value}</div>
    </div>
  )
}

function InfoSection({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="rounded-[22px] border border-[var(--hairline)] bg-[var(--panel-bg-inset)]/52 p-4">
      <h3 className="ws-pane-title">{title}</h3>
      <div className="mt-4 space-y-3 text-sm">{children}</div>
    </section>
  )
}

function KeyValue({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[var(--ink-3)]">{label}</span>
      <span className={strong ? "ws-num font-semibold text-[var(--ink)]" : "ws-num text-[var(--ink)]"}>{value}</span>
    </div>
  )
}

function DetailCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[18px] border border-[var(--hairline)] bg-[var(--panel-bg)] px-4 py-3">
      <div className="ws-meta">{label}</div>
      <div className="ws-num mt-2 break-all text-[12px] text-[var(--ink)]">{value}</div>
    </div>
  )
}

function JsonSurface({
  title,
  value,
  emptyText,
}: {
  title: string
  value: unknown
  emptyText: string
}) {
  if (value == null) {
    return (
      <div className="rounded-[22px] border border-dashed border-[var(--hairline)] bg-[var(--panel-bg-inset)]/40 px-4 py-10 text-center">
        <p className="ws-pane-title">{title}</p>
        <p className="ws-caption mt-2">{emptyText}</p>
      </div>
    )
  }

  return (
    <section className="rounded-[22px] border border-[var(--hairline)] bg-[var(--panel-bg)]">
      <div className="border-b border-[var(--hairline)] px-4 py-3">
        <div className="ws-pane-title">{title}</div>
      </div>
      <pre className="overflow-x-auto px-4 py-4 text-xs leading-6 text-[var(--ink-2)]">
        {JSON.stringify(value, null, 2)}
      </pre>
    </section>
  )
}

function formatCurrency(value: number) {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  })
}

function formatDateTime(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date)
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
