"use client"

import { useState } from "react"
import { ArrowRight, Copy } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"

import { GlassButton } from "@/components/ui/glass-button"
import {
  GlassCard,
  GlassCardContent,
  GlassCardDescription,
  GlassCardHeader,
  GlassCardTitle,
} from "@/components/ui/glass-card"
import {
  getNormalizedCacheSource,
  getReportedCacheReadTokens,
} from "@/lib/gateway-log/cache-metrics"
import type { GatewayLogDTO } from "@/types/gateway_log"
import { cn } from "@/lib/utils"

interface LogsDetailPanelProps {
  log: GatewayLogDTO | null
}

type LogsTranslator = ReturnType<typeof useTranslations>

export function LogsDetailPanel({ log }: LogsDetailPanelProps) {
  const t = useTranslations("logs")
  const locale = useLocale()
  const [copied, setCopied] = useState(false)
  const cacheReadTokens = log ? getReportedCacheReadTokens(log) : null
  const cacheWriteTokens = log?.cache_write_input_tokens ?? null
  const cacheSource = log ? getNormalizedCacheSource(log) : "unknown"
  const cacheStatusLabel = log ? getCacheStatusLabel(log, t) : t("detail.metrics.na")
  const usageSourceLabel = log ? getUsageSourceLabel(log.usage_source, t) : t("detail.metrics.na")
  const cacheSourceLabel = log ? getCacheSourceLabel(cacheSource, t) : t("detail.metrics.na")

  const canCopy = Boolean(log)
  const requestPayload = log?.meta && typeof log.meta === "object"
    ? (log.meta as Record<string, unknown>).request_payload
    : null
  const upstreamRequest = log?.meta && typeof log.meta === "object"
    ? (log.meta as Record<string, unknown>).upstream_request
    : null

  const handleCopy = async () => {
    if (!log || typeof window === "undefined") return

    const payload = {
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
      cached_tokens: log.cached_tokens,
      cache_read_input_tokens: log.cache_read_input_tokens,
      cache_write_input_tokens: log.cache_write_input_tokens,
      cache_source: log.cache_source,
      usage_source: log.usage_source,
      error_code: log.error_code,
      user_id: log.user_id,
      preset_id: log.preset_id,
      meta: log.meta,
      created_at: log.created_at,
    }

    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
  }

  return (
    <GlassCard>
      <GlassCardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <GlassCardTitle>{t("detail.title")}</GlassCardTitle>
            <GlassCardDescription>
              {log ? t("detail.id", { id: log.id }) : t("states.selectHint")}
            </GlassCardDescription>
          </div>
          <GlassButton
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleCopy}
            disabled={!canCopy}
          >
            <Copy className="h-4 w-4" />
            {copied ? t("states.copied") : t("detail.actions.copy")}
          </GlassButton>
        </div>
      </GlassCardHeader>

      <GlassCardContent>
        {!log && (
          <div className="rounded-xl border border-dashed border-[var(--border)] px-4 py-10 text-center text-sm text-[var(--muted)]">
            {t("states.selectHint")}
          </div>
        )}

        {log && (
          <div className="space-y-4">
            <div
              className={cn(
                "rounded-xl border px-4 py-3",
                log.status_code >= 400
                  ? "border-red-500/30 bg-red-500/8"
                  : "border-emerald-500/30 bg-emerald-500/8"
              )}
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                {log.status_code >= 400 ? t("detail.banner.failed") : t("detail.banner.success")}
              </p>
              <p className="mt-1 text-sm text-[var(--foreground)]">
                {t("detail.banner.statusLine", {
                  status: String(log.status_code),
                  time: formatDateTime(log.created_at, locale),
                })}
              </p>
            </div>

            <section className="rounded-xl border border-[var(--border)]/70 p-4">
              <h3 className="text-sm font-semibold text-[var(--foreground)]">
                {t("detail.sections.requestTrace")}
              </h3>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <TraceBadge label={t("detail.trace.client")} />
                <ArrowRight className="h-3.5 w-3.5 text-[var(--muted)]" />
                <TraceBadge label={t("detail.trace.gateway")} />
                <ArrowRight className="h-3.5 w-3.5 text-[var(--muted)]" />
                <TraceBadge label={t("table.trace.upstream")} />
                {log.error_code && (
                  <span className="rounded-md bg-red-500/15 px-2 py-1 text-red-300">
                    {t("detail.trace.errorDetail", { message: log.error_code })}
                  </span>
                )}
              </div>
            </section>

            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard label={t("detail.metrics.totalDuration")} value={`${log.duration_ms}ms`} />
              <MetricCard
                label={t("detail.metrics.ttft")}
                value={log.ttft_ms == null ? t("detail.metrics.na") : `${log.ttft_ms}ms`}
              />
              <MetricCard label={t("detail.metrics.statusCode")} value={String(log.status_code)} />
              <MetricCard
                label={t("detail.metrics.cacheStatus")}
                value={cacheStatusLabel}
              />
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-[var(--border)]/70 p-4">
                <h3 className="text-sm font-semibold text-[var(--foreground)]">
                  {t("detail.sections.tokenConsumption")}
                </h3>
                <div className="mt-3 space-y-2 text-sm">
                  <KeyValue
                    label={t("detail.tokens.input")}
                    value={new Intl.NumberFormat(locale).format(log.input_tokens)}
                  />
                  <KeyValue
                    label={t("detail.tokens.output")}
                    value={new Intl.NumberFormat(locale).format(log.output_tokens)}
                  />
                  <KeyValue
                    label={t("detail.tokens.total")}
                    value={new Intl.NumberFormat(locale).format(log.total_tokens)}
                    strong
                  />
                  <KeyValue
                    label={t("detail.tokens.cachedInput")}
                    value={
                      cacheReadTokens == null
                        ? t("detail.metrics.na")
                        : new Intl.NumberFormat(locale).format(cacheReadTokens)
                    }
                  />
                  <KeyValue
                    label={t("detail.tokens.cacheWrite")}
                    value={
                      cacheWriteTokens == null
                        ? t("detail.metrics.na")
                        : new Intl.NumberFormat(locale).format(cacheWriteTokens)
                    }
                  />
                </div>
              </div>

              <div className="rounded-xl border border-[var(--border)]/70 p-4">
                <h3 className="text-sm font-semibold text-[var(--foreground)]">
                  {t("detail.sections.costAnalysis")}
                </h3>
                <div className="mt-3 space-y-2 text-sm">
                  <KeyValue label={t("detail.cost.user")} value={`$${formatCurrency(log.cost_user)}`} />
                  <KeyValue
                    label={t("detail.cost.upstream")}
                    value={`$${formatCurrency(log.cost_upstream)}`}
                  />
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-[var(--border)]/70 p-4">
              <h3 className="text-sm font-semibold text-[var(--foreground)]">
                {t("detail.sections.technicalMetadata")}
              </h3>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <MetaItem label={t("detail.meta.requestId")} value={log.id} />
                <MetaItem label={t("detail.meta.model")} value={log.model} />
                <MetaItem
                  label={t("detail.meta.userId")}
                  value={log.user_id ?? t("detail.meta.anonymous")}
                />
                <MetaItem
                  label={t("detail.meta.presetId")}
                  value={log.preset_id ?? t("detail.meta.directCall")}
                />
                <MetaItem
                  label={t("detail.meta.errorCode")}
                  value={log.error_code ?? t("detail.metrics.na")}
                />
                <MetaItem
                  label={t("detail.meta.cacheSource")}
                  value={cacheSourceLabel}
                />
                <MetaItem
                  label={t("detail.meta.usageSource")}
                  value={usageSourceLabel}
                />
              </div>
              {upstreamRequest ? (
                <JsonDetail
                  className="mt-4"
                  title={t("detail.sections.upstreamRequest")}
                  value={upstreamRequest}
                />
              ) : null}
              {requestPayload ? (
                <JsonDetail
                  className="mt-4"
                  title={t("detail.sections.requestPayload")}
                  value={requestPayload}
                />
              ) : null}
            </section>
          </div>
        )}
      </GlassCardContent>
    </GlassCard>
  )
}

function TraceBadge({ label }: { label: string }) {
  return (
    <span className="rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-[var(--foreground)]">
      {label}
    </span>
  )
}

function getCacheStatusLabel(log: GatewayLogDTO, t: LogsTranslator) {
  if (!log.is_cached) return t("detail.metrics.miss")
  const source = getNormalizedCacheSource(log)
  if (source === "provider_reported") return t("detail.sources.providerReportedHit")
  if (source === "header_inferred") return t("detail.sources.headerInferredHit")
  return t("detail.metrics.hit")
}

function getCacheSourceLabel(
  source: string,
  t: LogsTranslator
) {
  if (source === "provider_reported") return t("detail.sources.providerReported")
  if (source === "header_inferred") return t("detail.sources.headerInferred")
  if (source === "request_flag") return t("detail.sources.requestFlag")
  return t("detail.sources.unknown")
}

function getUsageSourceLabel(
  source: string | null | undefined,
  t: LogsTranslator
) {
  const normalized = String(source ?? "")
    .trim()
    .toLowerCase()
  if (normalized === "provider_reported") return t("detail.sources.providerReported")
  if (normalized === "transformed") return t("detail.sources.transformed")
  return t("detail.sources.unknown")
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)]/70 bg-[var(--background)]/30 p-3">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className="mt-1 text-lg font-semibold text-[var(--foreground)] tabular-nums">{value}</p>
    </div>
  )
}

function KeyValue({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[var(--muted)]">{label}</span>
      <span className={cn("font-mono text-[var(--foreground)]", strong && "font-semibold")}>{value}</span>
    </div>
  )
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-[var(--background)]/30 p-3">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className="mt-1 break-all font-mono text-xs text-[var(--foreground)]">{value}</p>
    </div>
  )
}

function JsonDetail({
  title,
  value,
  className,
}: {
  title: string
  value: unknown
  className?: string
}) {
  return (
    <details className={cn("mt-4 rounded-lg border border-[var(--border)]/60 bg-[var(--background)]/20", className)}>
      <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-[var(--foreground)]">
        {title}
      </summary>
      <pre className="overflow-x-auto border-t border-[var(--border)]/50 px-3 py-3 text-xs text-[var(--foreground)]">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  )
}

function formatCurrency(value: number) {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  })
}

function formatDateTime(iso: string, locale: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date)
}
