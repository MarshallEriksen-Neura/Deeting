"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import { Search, Filter, X } from "lucide-react"

export interface FilterOption {
  label: string
  value: string
}

export interface FilterGroup {
  key: string
  label: string
  options: FilterOption[]
}

interface AdminFilterBarProps {
  searchPlaceholder?: string
  filters?: FilterGroup[]
  onSearch?: (query: string) => void
  onFilterChange?: (key: string, value: string) => void
  actions?: React.ReactNode
  className?: string
}

export function AdminFilterBar({
  searchPlaceholder,
  filters = [],
  onSearch,
  onFilterChange,
  actions,
  className,
}: AdminFilterBarProps) {
  const t = useTranslations("admin.common")
  const resolvedSearchPlaceholder = searchPlaceholder ?? t("searchPlaceholder")
  const [searchQuery, setSearchQuery] = React.useState("")
  const [activeFilters, setActiveFilters] = React.useState<
    Record<string, string>
  >({})
  const [showFilters, setShowFilters] = React.useState(false)

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value)
    onSearch?.(e.target.value)
  }

  const handleFilterChange = (key: string, value: string) => {
    const newFilters = { ...activeFilters }
    if (value === "") {
      delete newFilters[key]
    } else {
      newFilters[key] = value
    }
    setActiveFilters(newFilters)
    onFilterChange?.(key, value)
  }

  const clearFilters = () => {
    Object.keys(activeFilters).forEach((key) => {
      onFilterChange?.(key, "")
    })
    setActiveFilters({})
    setSearchQuery("")
    onSearch?.("")
  }

  const hasActiveFilters =
    Object.keys(activeFilters).length > 0 || searchQuery.length > 0

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center gap-3">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={handleSearch}
            placeholder={resolvedSearchPlaceholder}
            className="h-9 w-full rounded-lg border border-white/10 bg-white/5 px-9 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] focus:border-[var(--primary)]/50 focus:outline-none focus:ring-1 focus:ring-[var(--primary)]/25 transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => {
                setSearchQuery("")
                onSearch?.("")
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--foreground)] cursor-pointer"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        {/* Filter Toggle */}
        {filters.length > 0 && (
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm transition-colors cursor-pointer",
              showFilters || Object.keys(activeFilters).length > 0
                ? "border-[var(--primary)]/30 bg-[var(--primary)]/10 text-[var(--primary)]"
                : "border-white/10 bg-white/5 text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-white/10"
            )}
          >
            <Filter className="size-3.5" />
            <span>{t("filter")}</span>
            {Object.keys(activeFilters).length > 0 && (
              <span className="flex size-5 items-center justify-center rounded-full bg-[var(--primary)]/20 text-xs font-medium text-[var(--primary)]">
                {Object.keys(activeFilters).length}
              </span>
            )}
          </button>
        )}

        {/* Clear Filters */}
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 text-xs text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="size-3" />
            {t("clear")}
          </button>
        )}

        {/* Extra Actions */}
        {actions}
      </div>

      {/* Filter Dropdowns */}
      {showFilters && filters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/5 bg-white/[0.02] p-3">
          {filters.map((filter) => (
            <div key={filter.key} className="flex items-center gap-2">
              <span className="text-xs text-[var(--muted)]">
                {filter.label}:
              </span>
              <select
                value={activeFilters[filter.key] ?? ""}
                onChange={(e) =>
                  handleFilterChange(filter.key, e.target.value)
                }
                className="h-7 rounded-md border border-white/10 bg-white/5 px-2 text-xs text-[var(--foreground)] focus:border-[var(--primary)]/50 focus:outline-none cursor-pointer"
              >
                <option value="">{t("all")}</option>
                {filter.options.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
