"use client"

import * as React from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Search, X, Filter, ChevronDown } from "lucide-react"
import { useTranslations } from "next-intl"

import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { GlassButton } from "@/components/ui/glass-button"
import { Badge } from "@/components/ui/badge"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import type {
  ModelCapability,
  ModelFilterState,
  PriceTier,
} from "./types"
import {
  CAPABILITY_META,
  CONTEXT_WINDOW_PRESETS,
  formatContextWindow,
} from "./types"

/**
 * FilterLens - Layer B: The Filter Lens
 *
 * A floating glass bar for filtering through hundreds of models.
 * Features search, capability tags, and context window filters.
 */

interface FilterLensProps {
  filters: ModelFilterState
  onFiltersChange: (filters: ModelFilterState) => void
  totalModels: number
  filteredCount: number
  className?: string
}

// Capability tag button component
function CapabilityTag({
  capability,
  isSelected,
  onClick,
}: {
  capability: ModelCapability
  isSelected: boolean
  onClick: () => void
}) {
  const t = useTranslations('models')
  const meta = CAPABILITY_META[capability]

  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium",
        "transition-all duration-200 border",
        isSelected
          ? "bg-[var(--primary)]/20 border-[var(--primary)]/50 text-[var(--primary)]"
          : "bg-white/5 border-white/10 text-[var(--muted)] hover:bg-white/10 hover:text-[var(--foreground)]"
      )}
    >
      <span className="text-base">{meta.icon}</span>
      <span>{t(`capabilities.${capability}.label`)}</span>
    </motion.button>
  )
}

// Context window dropdown
function ContextWindowFilter({
  value,
  onChange,
}: {
  value: number | null
  onChange: (value: number | null) => void
}) {
  const t = useTranslations('models')
  const [isOpen, setIsOpen] = React.useState(false)

  // Map value to translation key suffix
  const getPresetKey = (val: number | null) => {
    if (val === null) return 'all'
    if (val === 8000) return '8k'
    if (val === 32000) return '32k'
    if (val === 128000) return '128k'
    if (val === 200000) return '200k'
    return 'all'
  }

  const selectedLabel = t(`contextPresets.${getPresetKey(value)}`)

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <GlassButton
          variant="ghost"
          size="sm"
          className={cn(
            "gap-2 text-sm",
            value ? "text-[var(--primary)]" : "text-[var(--muted)]"
          )}
        >
          <span>{t('filter.context', { label: selectedLabel })}</span>
          <ChevronDown className="size-3" />
        </GlassButton>
      </PopoverTrigger>
      <PopoverContent
        className="w-48 p-2 backdrop-blur-xl bg-[var(--background)]/90 border-white/10"
        align="start"
      >
        <div className="flex flex-col gap-1">
          {CONTEXT_WINDOW_PRESETS.map((preset) => (
            <button
              key={preset.label}
              onClick={() => {
                onChange(preset.value)
                setIsOpen(false)
              }}
              className={cn(
                "px-3 py-2 text-sm rounded-lg text-left transition-colors",
                value === preset.value
                  ? "bg-[var(--primary)]/20 text-[var(--primary)]"
                  : "text-[var(--foreground)] hover:bg-white/5"
              )}
            >
              {t(`contextPresets.${getPresetKey(preset.value)}`)}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

// Advanced filters popover
function AdvancedFilters({
  filters,
  onFiltersChange,
}: {
  filters: ModelFilterState
  onFiltersChange: (filters: ModelFilterState) => void
}) {
  const t = useTranslations('models')
  return (
    <Popover>
      <PopoverTrigger asChild>
        <GlassButton variant="ghost" size="icon-sm" className="hover:bg-white/5">
          <Filter className="size-4" />
        </GlassButton>
      </PopoverTrigger>
      <PopoverContent
        className="w-72 p-4 backdrop-blur-xl bg-[var(--background)]/90 border-white/10"
        align="end"
      >
        <div className="space-y-4">
          <h4 className="font-medium text-[var(--foreground)]">
            {t('filter.advanced')}
          </h4>

          {/* Active Only Toggle */}
          <div className="flex items-center justify-between">
            <Label htmlFor="active-only" className="text-sm text-[var(--muted)]">
              {t('filter.activeOnly')}
            </Label>
            <Switch
              id="active-only"
              checked={filters.active_only}
              onCheckedChange={(checked) =>
                onFiltersChange({ ...filters, active_only: checked })
              }
            />
          </div>

          {/* Price Tier Filter */}
          <div className="space-y-2">
            <Label className="text-sm text-[var(--muted)]">{t('filter.priceTier')}</Label>
            <div className="flex flex-wrap gap-1.5">
              {(['cheap', 'moderate', 'expensive', 'premium'] as PriceTier[]).map((tier) => (
                <button
                  key={tier}
                  onClick={() =>
                    onFiltersChange({
                      ...filters,
                      price_tier: filters.price_tier === tier ? null : tier,
                    })
                  }
                  className={cn(
                    "px-2 py-1 text-xs rounded-md border transition-colors capitalize",
                    filters.price_tier === tier
                      ? "bg-[var(--primary)]/20 border-[var(--primary)]/50 text-[var(--primary)]"
                      : "border-white/10 text-[var(--muted)] hover:bg-white/5"
                  )}
                >
                  {tier}
                </button>
              ))}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function FilterLens({
  filters,
  onFiltersChange,
  totalModels,
  filteredCount,
  className,
}: FilterLensProps) {
  const t = useTranslations('models')
  const hasActiveFilters =
    filters.search ||
    filters.capabilities.length > 0 ||
    filters.min_context_window !== null ||
    filters.active_only ||
    filters.price_tier !== null

  const handleCapabilityToggle = (capability: ModelCapability) => {
    const newCapabilities = filters.capabilities.includes(capability)
      ? filters.capabilities.filter((c) => c !== capability)
      : [...filters.capabilities, capability]
    onFiltersChange({ ...filters, capabilities: newCapabilities })
  }

  const handleClearFilters = () => {
    onFiltersChange({
      search: "",
      capabilities: [],
      min_context_window: null,
      active_only: false,
      price_tier: null,
    })
  }

  return (
    <div
      className={cn(
        "sticky top-4 z-20",
        "rounded-2xl border border-white/10",
        "bg-[var(--background)]/60 backdrop-blur-xl",
        "shadow-[0_8px_32px_-8px_rgba(0,0,0,0.2)]",
        "p-4",
        className
      )}
    >
      <div className="flex flex-col lg:flex-row lg:items-center gap-4">
        {/* Search Input */}
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[var(--muted)]" />
          <Input
            placeholder={t('filter.searchPlaceholder')}
            value={filters.search}
            onChange={(e) =>
              onFiltersChange({ ...filters, search: e.target.value })
            }
            className="pl-10 bg-white/5 border-white/10 focus:border-[var(--primary)]/50"
          />
          {filters.search && (
            <button
              onClick={() => onFiltersChange({ ...filters, search: "" })}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--foreground)]"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        {/* Capability Tags */}
        <div className="flex flex-wrap items-center gap-2">
          {(Object.keys(CAPABILITY_META) as ModelCapability[]).map((capability) => (
            <CapabilityTag
              key={capability}
              capability={capability}
              isSelected={filters.capabilities.includes(capability)}
              onClick={() => handleCapabilityToggle(capability)}
            />
          ))}
        </div>

        {/* Context Window + Advanced */}
        <div className="flex items-center gap-2 ml-auto">
          <ContextWindowFilter
            value={filters.min_context_window}
            onChange={(value) =>
              onFiltersChange({ ...filters, min_context_window: value })
            }
          />

          <div className="h-4 w-px bg-white/10" />

          <AdvancedFilters filters={filters} onFiltersChange={onFiltersChange} />

          {/* Clear Filters */}
          <AnimatePresence>
            {hasActiveFilters && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
              >
                <GlassButton
                  variant="ghost"
                  size="sm"
                  onClick={handleClearFilters}
                  className="text-[var(--muted)] hover:text-red-400"
                >
                  <X className="size-3 mr-1" />
                  {t('filter.clear')}
                </GlassButton>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Results Count */}
          <div className="h-4 w-px bg-white/10" />
          <span className="text-sm text-[var(--muted)] whitespace-nowrap">
            {filteredCount === totalModels ? (
              <>{t('filter.modelsCount', { count: totalModels })}</>
            ) : (
              <>{t('filter.filteredCount', { filtered: filteredCount, total: totalModels })}</>
            )}
          </span>
        </div>
      </div>
    </div>
  )
}

export default FilterLens
