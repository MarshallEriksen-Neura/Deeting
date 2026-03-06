"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import { Search, Filter, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

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
          <Input
            type="text"
            value={searchQuery}
            onChange={handleSearch}
            placeholder={resolvedSearchPlaceholder}
            className="h-9 w-full pl-9 pr-9"
          />
          {searchQuery && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => {
                setSearchQuery("")
                onSearch?.("")
              }}
              className="absolute right-1.5 top-1/2 -translate-y-1/2"
            >
              <X className="size-3.5" />
            </Button>
          )}
        </div>

        {/* Filter Toggle */}
        {filters.length > 0 && (
          <Button
            variant={showFilters || Object.keys(activeFilters).length > 0 ? "default" : "outline"}
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter className="size-3.5" />
            <span>{t("filter")}</span>
            {Object.keys(activeFilters).length > 0 && (
              <span className="flex size-5 items-center justify-center rounded-full bg-[var(--primary)]/20 text-xs font-medium text-[var(--primary)]">
                {Object.keys(activeFilters).length}
              </span>
            )}
          </Button>
        )}

        {/* Clear Filters */}
        {hasActiveFilters && (
          <Button
            variant="outline"
            size="sm"
            onClick={clearFilters}
          >
            <X className="size-3" />
            {t("clear")}
          </Button>
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
              <Select
                value={activeFilters[filter.key] ?? "__none__"}
                onValueChange={(v) =>
                  handleFilterChange(filter.key, v === "__none__" ? "" : v)
                }
              >
                <SelectTrigger className="h-7 w-auto min-w-[100px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t("all")}</SelectItem>
                  {filter.options.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
