"use client"

import { RefreshCw } from "lucide-react"

import { GlassButton } from "@/components/ui/glass-button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useTranslations } from "next-intl"

export type LogsFilters = {
  model: string
  statusCode: string
  cache: "all" | "hit" | "miss"
  errorCode: string
  start: string
  end: string
  pageSize: string
}

interface LogsFilterBarProps {
  value: LogsFilters
  onChange: (next: LogsFilters) => void
  onRefresh: () => void
  refreshing: boolean
}

const PAGE_SIZE_OPTIONS = ["20", "50", "100"] as const

const STATUS_OPTIONS = ["all", "200", "400", "401", "403", "404", "429", "500", "502", "503", "504"] as const

export function LogsFilterBar({ value, onChange, onRefresh, refreshing }: LogsFilterBarProps) {
  const t = useTranslations("logs")

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="grid gap-3 lg:grid-cols-12">
        <div className="lg:col-span-3">
          <Input
            value={value.model}
            onChange={(event) => onChange({ ...value, model: event.target.value })}
            placeholder={t("filters.model")}
            aria-label={t("filters.model")}
          />
        </div>

        <div className="lg:col-span-2">
          <Select
            value={value.statusCode}
            onValueChange={(statusCode) => onChange({ ...value, statusCode })}
          >
            <SelectTrigger aria-label={t("filters.status")}>
              <SelectValue placeholder={t("filters.status")} />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((code) => (
                <SelectItem key={code} value={code}>
                  {code === "all" ? t("filters.statusAll") : code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="lg:col-span-2">
          <Select
            value={value.cache}
            onValueChange={(cache) =>
              onChange({
                ...value,
                cache: cache as LogsFilters["cache"],
              })
            }
          >
            <SelectTrigger aria-label={t("filters.cacheAll")}>
              <SelectValue placeholder={t("filters.cacheAll")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("filters.cacheAll")}</SelectItem>
              <SelectItem value="hit">{t("filters.cacheHit")}</SelectItem>
              <SelectItem value="miss">{t("filters.cacheMiss")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="lg:col-span-2">
          <Input
            value={value.errorCode}
            onChange={(event) => onChange({ ...value, errorCode: event.target.value })}
            placeholder={t("filters.errorCode")}
            aria-label={t("filters.errorCode")}
          />
        </div>

        <div className="lg:col-span-3">
          <div className="grid grid-cols-2 gap-3">
            <Input
              type="datetime-local"
              value={value.start}
              onChange={(event) => onChange({ ...value, start: event.target.value })}
              aria-label={t("filters.start")}
            />
            <Input
              type="datetime-local"
              value={value.end}
              onChange={(event) => onChange({ ...value, end: event.target.value })}
              aria-label={t("filters.end")}
            />
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--muted)]">{t("filters.pageSize")}</span>
          <Select
            value={value.pageSize}
            onValueChange={(pageSize) => onChange({ ...value, pageSize })}
          >
            <SelectTrigger className="h-8 w-[120px]" aria-label={t("filters.pageSize")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <GlassButton type="button" variant="secondary" size="sm" onClick={onRefresh}>
          <RefreshCw className={refreshing ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          {t("filters.refresh")}
        </GlassButton>
      </div>
    </div>
  )
}
