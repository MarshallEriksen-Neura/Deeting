"use client"

import { useLocale, useTranslations } from "next-intl"
import { Database } from "lucide-react"

import { cn } from "@/lib/utils"
import type { GatewayLogDTO } from "@/types/gateway_log"

import {
  formatCurrency,
  formatDateTime,
  shortId,
} from "./logs-shared"

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
      <div className="flex flex-col">
        {Array.from({ length: 20 }).map((_, index) => (
          <div
            key={index}
            className="h-10 border-b border-[var(--hairline-subtle)] bg-[var(--background)] animate-pulse"
          />
        ))}
      </div>
    )
  }

  if (!items.length) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center p-12 text-center">
        <Database className="mb-4 size-8 text-[var(--ink-4)]" />
        <p className="text-[12px] font-bold uppercase tracking-widest text-[var(--ink-3)]">{t("table.noDataTitle")}</p>
        <p className="mt-2 text-[11px] text-[var(--ink-4)]">{t("table.noDataDescription")}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col bg-[var(--background)]">
      <div className="sticky top-0 z-10 flex h-8 items-center border-b border-[var(--hairline)] bg-[var(--background)] px-4 text-[10px] font-bold uppercase tracking-tight text-[var(--ink-3)]">
        <div className="w-[140px] shrink-0">{t("table.headers.timestamp")}</div>
        <div className="w-[60px] shrink-0">{t("table.headers.status")}</div>
        <div className="w-[100px] shrink-0">{t("table.headers.id")}</div>
        <div className="min-w-0 flex-1 px-4">{t("table.headers.model")}</div>
        <div className="w-[100px] shrink-0 text-right">{t("table.headers.duration")}</div>
        <div className="w-[80px] shrink-0 text-right">{t("table.headers.tokens")}</div>
        <div className="w-[80px] shrink-0 text-right">{t("table.headers.cost")}</div>
      </div>

      {items.map((item) => {
        const isSelected = selectedId === item.id
        const isError = item.status_code >= 400

        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item)}
            className={cn(
              "flex h-9 items-center border-b border-[var(--hairline-subtle)] px-4 text-[11px] font-mono transition-colors text-left",
              isSelected
                ? "bg-[var(--panel-bg-inset)] text-[var(--accent-ink)]"
                : "hover:bg-[var(--panel-bg-inset)] hover:text-[var(--ink)]"
            )}
          >
            <div className="w-[140px] shrink-0 text-[var(--ink-4)]">
              {formatDateTime(item.created_at, false, locale).split(" ")[1]}
              <span className="ml-1 opacity-50">{formatDateTime(item.created_at, false, locale).split(" ")[0]}</span>
            </div>

            <div className="w-[60px] shrink-0">
              <span className={cn(
                "font-bold",
                isError ? "text-[var(--danger)]" : item.is_cached ? "text-[var(--info)]" : "text-[var(--ok)]"
              )}>
                {item.status_code}
              </span>
            </div>

            <div className="w-[100px] shrink-0 text-[var(--ink-4)] font-bold uppercase">
              {shortId(item.id)}
            </div>

            <div className="min-w-0 flex-1 truncate px-4 font-bold text-[var(--ink-2)]">
              {item.model}
              {item.is_cached && (
                <span className="ml-2 text-[9px] text-[var(--info)] uppercase">[{t("table.cached")}]</span>
              )}
            </div>

            <div className="w-[100px] shrink-0 text-right text-[var(--ink-3)]">
              {t("table.durationValue", { value: item.duration_ms })}
            </div>

            <div className="w-[80px] shrink-0 text-right text-[var(--ink-4)]">
              {item.total_tokens.toLocaleString(locale)}
            </div>

            <div className="w-[80px] shrink-0 text-right text-[var(--ok)] opacity-80">
              ${formatCurrency(item.cost_user)}
            </div>
          </button>
        )
      })}
    </div>
  )
}
