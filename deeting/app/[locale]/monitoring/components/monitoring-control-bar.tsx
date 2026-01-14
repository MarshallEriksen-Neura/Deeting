"use client"

import { useTranslations } from "next-intl"
import { Clock, Bot, Key, Tag, RefreshCw } from "lucide-react"
import { useState } from "react"
import { cn } from "@/lib/utils"

/**
 * Monitoring Control Bar
 *
 * Pill-style filter controls for time range, models, API keys, and error codes
 */
export function MonitoringControlBar() {
  const t = useTranslations("monitoring.controlBar")
  const [autoRefresh, setAutoRefresh] = useState(true)

  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      {/* Left: Filter Pills */}
      <div className="flex flex-wrap items-center gap-3">
        <FilterPill
          icon={Clock}
          label={t("timeRange")}
          value="Past 24 Hours"
          options={["Past 1 Hour", "Past 24 Hours", "Past 7 Days", "Past 30 Days"]}
        />
        <FilterPill
          icon={Bot}
          label={t("models")}
          value="All Models"
          options={["All Models", "GPT-4", "Claude", "DeepSeek"]}
        />
        <FilterPill
          icon={Key}
          label={t("apiKeys")}
          value="All Keys"
          options={["All Keys", "Production", "Development", "Testing"]}
        />
        <FilterPill
          icon={Tag}
          label={t("errorCode")}
          value="All Errors"
          options={["All Errors", "4xx Client", "5xx Server", "429 Rate Limit"]}
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
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  options: string[]
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
        <span className="text-[var(--foreground)]">{value}</span>
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
              key={option}
              onClick={() => {
                setIsOpen(false)
              }}
              className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-[var(--muted)]/10"
            >
              {option}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
