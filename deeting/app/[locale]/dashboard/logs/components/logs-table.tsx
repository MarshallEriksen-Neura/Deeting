"use client"

import { ChevronRight } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"

import { Badge } from "@/components/ui/badge"
import { getNormalizedCacheSource } from "@/lib/gateway-log/cache-metrics"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"
import type { GatewayLogDTO } from "@/types/gateway_log"

interface LogsTableProps {
  items: GatewayLogDTO[]
  isLoading: boolean
  selectedId: string | null
  onSelect: (log: GatewayLogDTO) => void
}

export function LogsTable({ items, isLoading, selectedId, onSelect }: LogsTableProps) {
  const t = useTranslations("logs")
  const locale = useLocale()

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[...Array(8)].map((_, index) => (
          <div
            key={`logs-skeleton-${index}`}
            className="h-14 animate-pulse rounded-xl bg-[var(--foreground)]/5"
          />
        ))}
      </div>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="border-[var(--border)]/70">
          <TableHead className="w-[120px]">{t("table.headers.status")}</TableHead>
          <TableHead>{t("table.headers.requestModel")}</TableHead>
          <TableHead className="w-[180px]">{t("table.headers.time")}</TableHead>
          <TableHead className="w-[180px]">{t("table.headers.latency")}</TableHead>
          <TableHead className="w-[180px]">{t("table.headers.cost")}</TableHead>
          <TableHead className="w-[150px]" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.length === 0 && (
          <TableRow>
            <TableCell colSpan={6} className="py-12 text-center text-sm text-[var(--muted)]">
              {t("table.noData")}
            </TableCell>
          </TableRow>
        )}

        {items.map((item) => {
          const statusTone = getStatusTone(item.status_code, item.error_code)
          const isSelected = selectedId === item.id

          return (
            <TableRow
              key={item.id}
              tabIndex={0}
              onClick={() => onSelect(item)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault()
                  onSelect(item)
                }
              }}
              className={cn(
                "cursor-pointer border-[var(--border)]/50 transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/40",
                isSelected && "bg-[var(--primary)]/8"
              )}
            >
              <TableCell>
                <Badge className={cn("border-0", statusTone.badgeClass)}>{item.status_code}</Badge>
              </TableCell>

              <TableCell>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--foreground)]">{item.model}</p>
                  <div className="mt-1 flex items-center gap-2 text-xs text-[var(--muted)]">
                    <span className="font-mono">{shortId(item.id)}</span>
                    {item.error_code && (
                      <Badge variant="outline" className="border-red-500/30 text-red-300">
                        {item.error_code}
                      </Badge>
                    )}
                    {item.is_cached && (
                      <Badge variant="outline" className="border-emerald-500/30 text-emerald-300">
                        {getNormalizedCacheSource(item) === "provider_reported"
                          ? t("table.cacheBadge")
                          : t("table.cacheFlagBadge")}
                      </Badge>
                    )}
                  </div>
                </div>
              </TableCell>

              <TableCell>
                <div className="text-sm text-[var(--foreground)]">{formatDateTime(item.created_at, locale)}</div>
              </TableCell>

              <TableCell>
                <div className="font-mono text-sm text-[var(--foreground)]">{item.duration_ms}ms</div>
                <div className="mt-0.5 text-xs text-[var(--muted)]">
                  {item.ttft_ms != null
                    ? t("table.ttft", { value: String(item.ttft_ms) })
                    : t("detail.metrics.na")}
                </div>
              </TableCell>

              <TableCell>
                <div className="font-mono text-sm text-[var(--foreground)]">${formatCurrency(item.cost_user)}</div>
                <div className="mt-0.5 text-xs text-[var(--muted)]">
                  {t("table.totalTokens", {
                    value: new Intl.NumberFormat(locale).format(item.total_tokens),
                  })}
                </div>
              </TableCell>

              <TableCell>
                <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--primary)]">
                  {t("table.viewInspector")}
                  <ChevronRight className="h-3.5 w-3.5" />
                </span>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
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

function formatCurrency(value: number) {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  })
}

function shortId(value: string) {
  if (value.length <= 12) return value
  return `${value.slice(0, 8)}…${value.slice(-4)}`
}

function getStatusTone(statusCode: number, errorCode?: string | null) {
  if (statusCode <= 0 && errorCode) {
    return {
      badgeClass: "bg-red-500/15 text-red-300",
    }
  }

  if (statusCode <= 0) {
    return {
      badgeClass: "bg-slate-500/15 text-slate-300",
    }
  }

  if (statusCode >= 500) {
    return {
      badgeClass: "bg-red-500/15 text-red-300",
    }
  }

  if (statusCode >= 400) {
    return {
      badgeClass: "bg-amber-500/15 text-amber-300",
    }
  }

  if (statusCode >= 300) {
    return {
      badgeClass: "bg-blue-500/15 text-blue-300",
    }
  }

  return {
    badgeClass: "bg-emerald-500/15 text-emerald-300",
  }
}
