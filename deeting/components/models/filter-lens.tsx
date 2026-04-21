"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, X, Filter, ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { useDebounce } from "@/hooks/use-debounce";
import { Input } from "@/components/ui/shadcn/input";
import { GlassButton } from "@/components/ui/common/glass-button";
import { Badge } from "@/components/ui/shadcn/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/shadcn/popover";
import { Switch } from "@/components/ui/shadcn/switch";
import { Label } from "@/components/ui/shadcn/label";
import type { ModelCapability, ModelFilterState, PriceTier } from "./types";
import { CAPABILITY_META, CONTEXT_WINDOW_PRESETS } from "./types";

interface FilterLensProps {
  filters: ModelFilterState;
  onFiltersChange: (filters: ModelFilterState) => void;
  totalModels: number;
  filteredCount: number;
  onBatchUpdateCapabilities?: (capabilities: ModelCapability[]) => Promise<void>;
  className?: string;
}

function CapabilityTag({ capability, isSelected, onClick }: { capability: ModelCapability; isSelected: boolean; onClick: () => void }) {
  const t = useTranslations("models");
  const meta = CAPABILITY_META[capability];
  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-all duration-200",
        isSelected
          ? "border-[var(--primary)]/50 bg-[var(--primary)]/20 text-[var(--primary)]"
          : "border-white/10 bg-white/5 text-[var(--muted)] hover:bg-white/10 hover:text-[var(--foreground)]"
      )}
    >
      <span className="text-xs font-semibold">{meta.icon}</span>
      <span>{t(`capabilities.${capability}.label`)}</span>
    </motion.button>
  );
}

function ContextWindowFilter({ value, onChange }: { value: number | null; onChange: (value: number | null) => void }) {
  const t = useTranslations("models");
  const [isOpen, setIsOpen] = React.useState(false);
  const getPresetKey = (val: number | null) => {
    if (val === null) return "all";
    if (val === 8000) return "8k";
    if (val === 32000) return "32k";
    if (val === 128000) return "128k";
    if (val === 200000) return "200k";
    return "all";
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <GlassButton variant="ghost" size="sm" className={cn("gap-2 text-sm", value ? "text-[var(--primary)]" : "text-[var(--muted)]")}>
          <span>{t("filter.context", { label: t(`contextPresets.${getPresetKey(value)}`) })}</span>
          <ChevronDown className="size-3" />
        </GlassButton>
      </PopoverTrigger>
      <PopoverContent className="w-48 border-white/10 bg-[var(--background)]/90 p-2 backdrop-blur-xl" align="start">
        <div className="flex flex-col gap-1">
          {CONTEXT_WINDOW_PRESETS.map((preset) => (
            <button
              key={preset.label}
              onClick={() => {
                onChange(preset.value);
                setIsOpen(false);
              }}
              className={cn(
                "rounded-lg px-3 py-2 text-left text-sm transition-colors",
                value === preset.value ? "bg-[var(--primary)]/20 text-[var(--primary)]" : "text-[var(--foreground)] hover:bg-white/5"
              )}
            >
              {t(`contextPresets.${getPresetKey(preset.value)}`)}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function AdvancedFilters({ filters, onFiltersChange }: { filters: ModelFilterState; onFiltersChange: (filters: ModelFilterState) => void }) {
  const t = useTranslations("models");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <GlassButton variant="ghost" size="icon-sm" className="hover:bg-white/5">
          <Filter className="size-4" />
        </GlassButton>
      </PopoverTrigger>
      <PopoverContent className="w-72 border-white/10 bg-[var(--background)]/90 p-4 backdrop-blur-xl" align="end">
        <div className="space-y-4">
          <h4 className="font-medium text-[var(--foreground)]">{t("filter.advanced")}</h4>
          <div className="flex items-center justify-between">
            <Label htmlFor="active-only" className="text-sm text-[var(--muted)]">{t("filter.activeOnly")}</Label>
            <Switch id="active-only" checked={filters.active_only} onCheckedChange={(checked) => onFiltersChange({ ...filters, active_only: checked })} />
          </div>
          <div className="space-y-2">
            <Label className="text-sm text-[var(--muted)]">{t("filter.priceTier")}</Label>
            <div className="flex flex-wrap gap-1.5">
              {(["cheap", "moderate", "expensive", "premium"] as PriceTier[]).map((tier) => (
                <button
                  key={tier}
                  onClick={() => onFiltersChange({ ...filters, price_tier: filters.price_tier === tier ? null : tier })}
                  className={cn(
                    "rounded-md border px-2 py-1 text-xs capitalize transition-colors",
                    filters.price_tier === tier
                      ? "border-[var(--primary)]/50 bg-[var(--primary)]/20 text-[var(--primary)]"
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
  );
}

export function FilterLens({ filters, onFiltersChange, totalModels, filteredCount, onBatchUpdateCapabilities, className }: FilterLensProps) {
  const t = useTranslations("models");
  const [batchCaps, setBatchCaps] = React.useState<ModelCapability[]>([]);
  const [batchLoading, setBatchLoading] = React.useState(false);
  const [localSearch, setLocalSearch] = React.useState(filters.search);
  const debouncedSearch = useDebounce(localSearch, 300);

  React.useEffect(() => {
    if (debouncedSearch !== filters.search) {
      onFiltersChange({ ...filters, search: debouncedSearch });
    }
  }, [debouncedSearch]);

  React.useEffect(() => {
    if (filters.search !== localSearch && filters.search === "") {
      setLocalSearch("");
    }
  }, [filters.search]);

  const hasActiveFilters = filters.search || filters.capabilities.length > 0 || filters.min_context_window !== null || filters.active_only || filters.price_tier !== null;

  const handleCapabilityToggle = (capability: ModelCapability) => {
    const newCapabilities = filters.capabilities.includes(capability)
      ? filters.capabilities.filter((item) => item !== capability)
      : [...filters.capabilities, capability];
    onFiltersChange({ ...filters, capabilities: newCapabilities });
  };

  const handleClearFilters = () => {
    setLocalSearch("");
    onFiltersChange({ search: "", capabilities: [], min_context_window: null, active_only: false, price_tier: null });
    setBatchCaps([]);
  };

  const handleBatchCapToggle = (capability: ModelCapability) => {
    setBatchCaps((prev) => (prev.includes(capability) ? prev.filter((item) => item !== capability) : [...prev, capability]));
  };

  const handleBatchApply = async () => {
    if (!onBatchUpdateCapabilities || batchCaps.length === 0) return;
    setBatchLoading(true);
    try {
      await onBatchUpdateCapabilities(batchCaps);
      setBatchCaps([]);
    } finally {
      setBatchLoading(false);
    }
  };

  const showBatchBar = !!onBatchUpdateCapabilities && !!filters.search && filteredCount > 0 && filteredCount < totalModels;

  return (
    <div className={cn("sticky top-4 z-20 rounded-2xl border border-white/10 bg-[var(--background)]/60 p-4 shadow-[0_8px_32px_-8px_rgba(0,0,0,0.2)] backdrop-blur-xl", className)}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        <div className="relative max-w-md min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]" />
          <Input placeholder={t("filter.searchPlaceholder")} value={localSearch} onChange={(event) => setLocalSearch(event.target.value)} className="border-white/10 bg-white/5 pl-10 focus:border-[var(--primary)]/50" />
          {localSearch ? (
            <button onClick={() => { setLocalSearch(""); onFiltersChange({ ...filters, search: "" }); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--foreground)]">
              <X className="size-4" />
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(Object.keys(CAPABILITY_META) as ModelCapability[]).map((capability) => (
            <CapabilityTag key={capability} capability={capability} isSelected={filters.capabilities.includes(capability)} onClick={() => handleCapabilityToggle(capability)} />
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <ContextWindowFilter value={filters.min_context_window} onChange={(value) => onFiltersChange({ ...filters, min_context_window: value })} />
          <div className="h-4 w-px bg-white/10" />
          <AdvancedFilters filters={filters} onFiltersChange={onFiltersChange} />
          <AnimatePresence>
            {hasActiveFilters ? (
              <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}>
                <GlassButton variant="ghost" size="sm" onClick={handleClearFilters} className="text-[var(--muted)] hover:text-red-400">
                  <X className="mr-1 size-3" />
                  {t("filter.clear")}
                </GlassButton>
              </motion.div>
            ) : null}
          </AnimatePresence>
          <div className="h-4 w-px bg-white/10" />
          <span className="whitespace-nowrap text-sm text-[var(--muted)]">
            {filteredCount === totalModels ? t("filter.modelsCount", { count: totalModels }) : t("filter.filteredCount", { filtered: filteredCount, total: totalModels })}
          </span>
        </div>
      </div>
      <AnimatePresence>
        {showBatchBar ? (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
            <div className="mt-3 border-t border-white/10 pt-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="flex-1 space-y-2">
                  <p className="text-xs text-[var(--muted)]">{t("filter.batchHint", { count: filteredCount })}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(Object.keys(CAPABILITY_META) as ModelCapability[]).map((capability) => {
                      const active = batchCaps.includes(capability);
                      return (
                        <button
                          key={capability}
                          onClick={() => handleBatchCapToggle(capability)}
                          disabled={batchLoading}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-all duration-150",
                            active ? "border-[var(--primary)]/50 bg-[var(--primary)]/20 text-[var(--primary)]" : "border-white/10 bg-white/5 text-[var(--muted)] hover:bg-white/10"
                          )}
                        >
                          <span>{CAPABILITY_META[capability].icon}</span>
                          <span>{t(`capabilities.${capability}.label`)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <GlassButton size="sm" disabled={batchCaps.length === 0 || batchLoading} onClick={handleBatchApply} className="shrink-0">
                  {batchLoading ? t("filter.batchApplying") : t("filter.batchApply", { count: filteredCount })}
                </GlassButton>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
