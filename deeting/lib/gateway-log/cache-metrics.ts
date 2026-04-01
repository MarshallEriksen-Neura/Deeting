type CacheMetricLogLike = {
  input_tokens?: number | null
  is_cached?: boolean | null
  cached_tokens?: number | null
  cache_read_input_tokens?: number | null
  cache_source?: string | null
}

function toFiniteNonNegative(value: unknown): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0) return 0
  return numeric
}

function roundTo2(value: number): number {
  return Math.round(value * 100) / 100
}

export function getReportedCacheReadTokens(log: CacheMetricLogLike): number | null {
  const direct = [log.cache_read_input_tokens, log.cached_tokens]
  for (const value of direct) {
    if (value == null) continue
    return toFiniteNonNegative(value)
  }
  return null
}

export function hasProviderReportedCacheUsage(log: CacheMetricLogLike): boolean {
  return (
    (log.cache_source ?? "").trim().toLowerCase() === "provider_reported" ||
    getReportedCacheReadTokens(log) != null
  )
}

export function getNormalizedCacheSource(log: CacheMetricLogLike): string {
  const source = String(log.cache_source ?? "")
    .trim()
    .toLowerCase()
  if (source) return source
  if (log.is_cached) return "request_flag"
  return "unknown"
}

export function computeRequestCacheHitRate(logs: CacheMetricLogLike[]): number {
  if (logs.length === 0) return 0
  const hits = logs.filter((item) => Boolean(item.is_cached)).length
  return roundTo2((hits / logs.length) * 100)
}

export function computeProviderCacheReuseRate(logs: CacheMetricLogLike[]): number | null {
  let totalInputTokens = 0
  let totalCachedReadTokens = 0
  let hasProviderSignals = false

  for (const log of logs) {
    if (!hasProviderReportedCacheUsage(log)) continue
    hasProviderSignals = true
    totalInputTokens += toFiniteNonNegative(log.input_tokens)
    totalCachedReadTokens += toFiniteNonNegative(getReportedCacheReadTokens(log))
  }

  if (!hasProviderSignals) return null
  if (totalInputTokens <= 0) return 0
  return roundTo2((totalCachedReadTokens / totalInputTokens) * 100)
}

export function computePreferredDesktopCacheRate(
  logs: CacheMetricLogLike[],
  fallbackRate?: number | null
): number {
  const providerRate = computeProviderCacheReuseRate(logs)
  if (providerRate != null) return providerRate
  if (fallbackRate != null && Number.isFinite(Number(fallbackRate))) {
    return roundTo2(Number(fallbackRate))
  }
  return computeRequestCacheHitRate(logs)
}
