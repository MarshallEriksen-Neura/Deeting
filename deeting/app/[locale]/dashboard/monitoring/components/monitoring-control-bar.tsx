"use client"

import { useTranslations } from "next-intl"
import { Clock, Bot, Key, Tag, RefreshCw } from "lucide-react"
import { useState } from "react"
import { cn } from "@/lib/utils"

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

  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      {/* Left: Filter Pills */}
      <div className="flex flex-wrap items-center gap-3">
        <FilterPill
          icon={Clock}
          label={t("timeRange")}
          value={value.timeRange}
          options={[
            { label: "Past 24 Hours", value: "24h" },
            { label: "Past 7 Days", value: "7d" },
            { label: "Past 30 Days", value: "30d" },
          ]}
          onSelect={(v) => onChange({ ...value, timeRange: v as MonitoringFilters["timeRange"] })}
        />
        <FilterPill
          icon={Bot}
          label={t("models")}
          value={value.model || "All Models"}
          options={[
            { label: "All Models", value: undefined },
            { label: "GPT-4", value: "gpt-4" },
            { label: "Claude", value: "claude" },
            { label: "DeepSeek", value: "deepseek" },
          ]}
          onSelect={(v) => onChange({ ...value, model: v as string | undefined })}
        />
        <FilterPill
          icon={Key}
          label={t("apiKeys")}
          value={value.apiKey || "All Keys"}
          options={[
            { label: "All Keys", value: undefined },
            { label: "Production", value: "prod" },
            { label: "Development", value: "dev" },
            { label: "Testing", value: "test" },
          ]}
          onSelect={(v) => onChange({ ...value, apiKey: v as string | undefined })}
        />
        <FilterPill
          icon={Tag}
          label={t("errorCode")}
          value={value.errorCode || "All Errors"}
          options={[
            { label: "All Errors", value: undefined },
            { label: "4xx Client", value: "4xx" },
            { label: "5xx Server", value: "5xx" },
            { label: "429 Rate Limit", value: "429" },
          ]}
          onSelect={(v) => onChange({ ...value, errorCode: v as string | undefined })}
        />
      </div>

      {/* Right: Auto Refresh Toggle */}
      <button
        onClick={() => setAutoRefresh(!autoRefresh)}
        className={cn(
          "flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all",
          autoRefresh
            ? "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
            : "bg-[var(--muted)]/20 text-[var(--muted)] hover:bg-[var(--muted)]/30"
        )}
      >
        <RefreshCw className={cn("h-4 w-4", autoRefresh && "animate-spin")} />
        {t("autoRefresh")}: {autoRefresh ? t("on") : t("off")}
      </button>
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
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="relative">
      <button
            onClick={() => setIsOpen(!isOpen)}
            className={cn(
              "flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-sm font-medium transition-all",
              "hover:border-[var(--primary)] hover:bg-[var(--primary)]/5"
            )}
          >
            <Icon className="h-4 w-4 text-[var(--muted)]" />
            <span className="text-[var(--foreground)]">{value ?? options[0]?.label ?? ""}</span>
        <svg
          className={cn(
            "h-4 w-4 text-[var(--muted)] transition-transform",
            isOpen && "rotate-180"
          )}
          viewBox="0 0 12 12"
          fill="none"
        >
          <path
            d="M3 4.5L6 7.5L9 4.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {/* Dropdown (placeholder - would use proper dropdown component) */}
      {isOpen && (
        <div className="absolute top-full left-0 z-10 mt-2 w-48 rounded-lg border border-[var(--border)] bg-[var(--card)] p-2 shadow-xl">
          {options.map((option) => (
            <button
              key={option.label}
              onClick={() => {
                onSelect(option.value)
                setIsOpen(false)
              }}
              className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-[var(--muted)]/10"
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
