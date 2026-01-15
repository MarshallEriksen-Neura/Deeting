"use client"

import { useTranslations } from "next-intl"
import { Clock, Bot, Key, Tag, RefreshCw, ChevronDown } from "lucide-react"
import { useState } from "react"
import { cn } from "@/lib/utils"
import { GlassButton } from "@/components/ui/glass-button"
import {
  GlassDropdownMenu,
  GlassDropdownMenuContent,
  GlassDropdownMenuItem,
  GlassDropdownMenuLabel,
  GlassDropdownMenuSeparator,
  GlassDropdownMenuTrigger,
} from "@/components/ui/glass-dropdown"

export type MonitoringFilters = {
  timeRange: "24h" | "7d" | "30d"
  model?: string
  apiKey?: string
  errorCode?: string
}

/**
 * Monitoring Control Bar
 *
 * Pill-style filter controls for time range, models, API keys, and error codes
 */
export function MonitoringControlBar({
  value,
  onChange,
}: {
  value: MonitoringFilters
  onChange: (next: MonitoringFilters) => void
}) {
  const t = useTranslations("monitoring.controlBar")
  const [autoRefresh, setAutoRefresh] = useState(true)
  const timeRangeOptions = [
    { label: t("timeRangeOptions.24h"), value: "24h" },
    { label: t("timeRangeOptions.7d"), value: "7d" },
    { label: t("timeRangeOptions.30d"), value: "30d" },
  ]
  const modelOptions = [
    { label: t("modelOptions.all"), value: undefined },
    { label: t("modelOptions.gpt4"), value: "gpt-4" },
    { label: t("modelOptions.claude"), value: "claude" },
    { label: t("modelOptions.deepseek"), value: "deepseek" },
  ]
  const apiKeyOptions = [
    { label: t("apiKeyOptions.all"), value: undefined },
    { label: t("apiKeyOptions.production"), value: "prod" },
    { label: t("apiKeyOptions.development"), value: "dev" },
    { label: t("apiKeyOptions.testing"), value: "test" },
  ]
  const errorOptions = [
    { label: t("errorOptions.all"), value: undefined },
    { label: t("errorOptions.client4xx"), value: "4xx" },
    { label: t("errorOptions.server5xx"), value: "5xx" },
    { label: t("errorOptions.rateLimit429"), value: "429" },
  ]

  return (
    <div className="mb-6 flex flex-col gap-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 md:flex-row md:items-center md:justify-between">
      {/* Left: Filter Pills */}
      <div className="flex w-full flex-wrap items-center gap-3 md:w-auto md:flex-1">
        <FilterPill
          icon={Clock}
          label={t("timeRange")}
          value={value.timeRange}
          options={timeRangeOptions}
          onSelect={(v) => onChange({ ...value, timeRange: v as MonitoringFilters["timeRange"] })}
        />
        <FilterPill
          icon={Bot}
          label={t("models")}
          value={value.model}
          options={modelOptions}
          onSelect={(v) => onChange({ ...value, model: v as string | undefined })}
        />
        <FilterPill
          icon={Key}
          label={t("apiKeys")}
          value={value.apiKey}
          options={apiKeyOptions}
          onSelect={(v) => onChange({ ...value, apiKey: v as string | undefined })}
        />
        <FilterPill
          icon={Tag}
          label={t("errorCode")}
          value={value.errorCode}
          options={errorOptions}
          onSelect={(v) => onChange({ ...value, errorCode: v as string | undefined })}
        />
      </div>

      {/* Right: Auto Refresh Toggle */}
      <GlassButton
        onClick={() => setAutoRefresh(!autoRefresh)}
        type="button"
        variant="ghost"
        size="sm"
        aria-pressed={autoRefresh}
        className={cn(
          "w-full justify-center rounded-full px-4 py-2 text-sm font-medium transition-all md:w-auto",
          autoRefresh
            ? "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
            : "bg-[var(--muted)]/20 text-[var(--muted)] hover:bg-[var(--muted)]/30"
        )}
      >
        <RefreshCw className={cn("h-4 w-4", autoRefresh && "animate-spin")} />
        {t("autoRefresh")}: {autoRefresh ? t("on") : t("off")}
      </GlassButton>
    </div>
  )
}

function FilterPill({
  icon: Icon,
  label,
  value,
  options,
  onSelect,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string | undefined
  options: { label: string; value: string | undefined }[]
  onSelect: (value: string | undefined) => void
}) {
  const selectedLabel =
    options.find((option) => option.value === value)?.label ??
    options[0]?.label ??
    ""

  return (
    <GlassDropdownMenu>
      <GlassDropdownMenuTrigger asChild>
        <GlassButton
          type="button"
          variant="secondary"
          size="sm"
          className={cn(
            "h-9 rounded-full border border-[var(--border)] bg-[var(--background)] px-4 text-sm font-medium",
            "text-[var(--foreground)] hover:border-[var(--primary)] hover:bg-[var(--primary)]/5"
          )}
          aria-label={label}
        >
          <Icon className="h-4 w-4 text-[var(--muted)]" />
          <span className="max-w-[140px] truncate">{selectedLabel}</span>
          <ChevronDown className="h-4 w-4 text-[var(--muted)]" />
        </GlassButton>
      </GlassDropdownMenuTrigger>
      <GlassDropdownMenuContent className="w-52 max-w-[calc(100vw-2rem)]" align="start">
        <GlassDropdownMenuLabel>{label}</GlassDropdownMenuLabel>
        <GlassDropdownMenuSeparator />
        {options.map((option) => (
          <GlassDropdownMenuItem
            key={`${label}-${option.value ?? "all"}`}
            selected={option.value === value}
            onClick={() => onSelect(option.value)}
          >
            {option.label}
          </GlassDropdownMenuItem>
        ))}
      </GlassDropdownMenuContent>
    </GlassDropdownMenu>
  )
}
