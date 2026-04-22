"use client"

import { useState } from "react"
import { ArrowRight, Copy } from "lucide-react"

import { Button } from "@/components/ui/shadcn/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/shadcn/card"
import {
  getNormalizedCacheSource,
  getReportedCacheReadTokens,
} from "@/lib/gateway-log/cache-metrics"
import type { GatewayLogDTO } from "@/types/gateway_log"

interface LogsDetailPanelProps {
  log: GatewayLogDTO | null
}

export function LogsDetailPanel({ log }: LogsDetailPanelProps) {
  const [copied, setCopied] = useState(false)
  const cacheReadTokens = log ? getReportedCacheReadTokens(log) : null
  const cacheWriteTokens = log?.cache_write_input_tokens ?? null
  const cacheSource = log ? getNormalizedCacheSource(log) : "unknown"
  const requestPayload = log?.meta && typeof log.meta === "object"
    ? (log.meta as Record<string, unknown>).request_payload
    : null
  const upstreamRequest = log?.meta && typeof log.meta === "object"
    ? (log.meta as Record<string, unknown>).upstream_request
    : null

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
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>日志详情</CardTitle>
            <CardDescription>
              {log ? `请求 ID: ${log.id}` : "从左侧选择一条日志查看完整信息"}
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => void handleCopy()} disabled={!log}>
            <Copy className="size-4" />
            {copied ? "已复制" : "复制 JSON"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!log ? (
          <div className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
            从左侧选择一条日志查看完整信息
          </div>
        ) : (
          <div className="space-y-4">
            <div className={`rounded-xl border px-4 py-3 ${log.status_code >= 400 ? "border-red-500/20 bg-red-500/5" : "border-emerald-500/20 bg-emerald-500/5"}`}>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {log.status_code >= 400 ? "请求失败" : "请求成功"}
              </div>
              <div className="mt-1 text-sm">
                状态 {log.status_code} · {formatDateTime(log.created_at)}
              </div>
            </div>

            <section className="rounded-xl border p-4">
              <h3 className="text-sm font-semibold">请求链路</h3>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <TraceBadge label="Client" />
                <ArrowRight className="size-3.5 text-muted-foreground" />
                <TraceBadge label="Gateway" />
                <ArrowRight className="size-3.5 text-muted-foreground" />
                <TraceBadge label="Upstream" />
                {log.error_code ? <TraceBadge label={`Error: ${log.error_code}`} /> : null}
              </div>
            </section>

            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard label="总耗时" value={`${log.duration_ms}ms`} />
              <MetricCard label="TTFT" value={log.ttft_ms == null ? "-" : `${log.ttft_ms}ms`} />
              <MetricCard label="状态码" value={String(log.status_code)} />
              <MetricCard label="缓存状态" value={log.is_cached ? "命中" : "未命中"} />
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border p-4">
                <h3 className="text-sm font-semibold">Token 消耗</h3>
                <div className="mt-3 space-y-2 text-sm">
                  <KeyValue label="输入" value={log.input_tokens.toLocaleString()} />
                  <KeyValue label="输出" value={log.output_tokens.toLocaleString()} />
                  <KeyValue label="总计" value={log.total_tokens.toLocaleString()} strong />
                  <KeyValue label="缓存读取" value={cacheReadTokens == null ? "-" : cacheReadTokens.toLocaleString()} />
                  <KeyValue label="缓存写入" value={cacheWriteTokens == null ? "-" : cacheWriteTokens.toLocaleString()} />
                </div>
              </div>

              <div className="rounded-xl border p-4">
                <h3 className="text-sm font-semibold">成本分析</h3>
                <div className="mt-3 space-y-2 text-sm">
                  <KeyValue label="用户成本" value={`$${formatCurrency(log.cost_user)}`} />
                  <KeyValue label="上游成本" value={`$${formatCurrency(log.cost_upstream)}`} />
                  <KeyValue label="缓存来源" value={cacheSource} />
                </div>
              </div>
            </section>

            <section className="rounded-xl border p-4">
              <h3 className="text-sm font-semibold">技术元数据</h3>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <MetaItem label="Request ID" value={log.id} />
                <MetaItem label="模型" value={log.model} />
                <MetaItem label="用户 ID" value={log.user_id ?? "匿名"} />
                <MetaItem label="Preset ID" value={log.preset_id ?? "直接调用"} />
                <MetaItem label="错误码" value={log.error_code ?? "-"} />
                <MetaItem label="使用来源" value={log.usage_source ?? "-"} />
              </div>
              {upstreamRequest ? <JsonDetail className="mt-4" title="上游请求" value={upstreamRequest} /> : null}
              {requestPayload ? <JsonDetail className="mt-4" title="网关请求载荷" value={requestPayload} /> : null}
            </section>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function TraceBadge({ label }: { label: string }) {
  return <span className="rounded-md border bg-background px-2 py-1">{label}</span>
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-background/30 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  )
}

function KeyValue({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? "font-mono font-semibold" : "font-mono"}>{value}</span>
    </div>
  )
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-background/30 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 break-all font-mono text-xs">{value}</div>
    </div>
  )
}

function JsonDetail({ title, value, className }: { title: string; value: unknown; className?: string }) {
  return (
    <details className={className ? `${className} rounded-lg border bg-background/20` : "rounded-lg border bg-background/20"}>
      <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium">{title}</summary>
      <pre className="overflow-x-auto border-t px-3 py-3 text-xs">{JSON.stringify(value, null, 2)}</pre>
    </details>
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
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date)
}
