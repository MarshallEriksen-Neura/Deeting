export type StatusTone = "ok" | "warn" | "danger" | "accent"
export type StatusLabelKey = "failed" | "upstreamError" | "requestError" | "redirect" | "success"

export function isFailedRequest(statusCode: number, errorCode?: string | null) {
  return statusCode >= 400 || (statusCode <= 0 && Boolean(errorCode))
}

export function getStatusTone(statusCode: number, errorCode?: string | null): StatusTone {
  if (statusCode <= 0 && errorCode) return "danger"
  if (statusCode >= 500) return "danger"
  if (statusCode >= 400) return "warn"
  if (statusCode >= 300) return "accent"
  return "ok"
}

export function getStatusLabelKey(statusCode: number, errorCode?: string | null): StatusLabelKey {
  if (statusCode <= 0 && errorCode) return "failed"
  if (statusCode >= 500) return "upstreamError"
  if (statusCode >= 400) return "requestError"
  if (statusCode >= 300) return "redirect"
  return "success"
}

export function formatCurrency(value: number) {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  })
}

export function formatDateTime(iso: string, includeYear = false, locale = "en") {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso

  return new Intl.DateTimeFormat(locale, {
    ...(includeYear ? { year: "numeric" as const } : {}),
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date)
}

export function formatRelativeTime(iso: string, locale = "en") {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso

  const deltaMs = date.getTime() - Date.now()
  const minutes = Math.round(deltaMs / 60_000)
  if (Math.abs(minutes) < 60) {
    return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(minutes, "minute")
  }

  const hours = Math.round(deltaMs / 3_600_000)
  if (Math.abs(hours) < 24) {
    return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(hours, "hour")
  }

  const days = Math.round(deltaMs / 86_400_000)
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(days, "day")
}

export function shortId(value: string) {
  if (value.length <= 12) return value
  return `${value.slice(0, 8)}...${value.slice(-4)}`
}
