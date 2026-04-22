"use client";

import * as React from "react";
import { Search, X, Filter, ChevronDown, Check, LayoutGrid } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { useDebounce } from "@/hooks/use-debounce";
import { Input } from "@/components/ui/shadcn/input";
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
  className?: string;
}

function CapabilityFilter({ selected, onToggle }: { selected: ModelCapability[]; onToggle: (cap: ModelCapability) => void }) {
  const t = useTranslations("models");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className={cn(
          "ws-control flex h-9 items-center gap-2 rounded-xl border px-3.5 transition-all",
          selected.length > 0 
            ? "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-ink)] font-bold" 
            : "border-[var(--hairline)] bg-[var(--panel-bg)] text-[var(--ink-3)] hover:bg-[var(--panel-bg-inset)]"
        )}>
          <LayoutGrid className="size-3.5" />
          <span className="text-[11px] tracking-tight">
            {selected.length > 0 ? `${selected.length} capabilities` : "All capabilities"}
          </span>
          <ChevronDown className="size-3 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 ws-bezel-inner p-2 shadow-2xl border-[var(--hairline-strong)]" align="start">
        <div className="flex flex-col gap-0.5">
          {(Object.keys(CAPABILITY_META) as ModelCapability[]).map((cap) => {
            const active = selected.includes(cap);
            return (
              <button
                key={cap}
                onClick={() => onToggle(cap)}
                className={cn(
                  "ws-control rounded-lg px-3 py-2 text-left text-[12px] transition-colors flex items-center justify-between group",
                  active ? "bg-[var(--accent-soft)] text-[var(--accent-ink)] font-bold" : "text-[var(--ink)] hover:bg-[var(--panel-bg-inset)]"
                )}
              >
                <div className="flex items-center gap-2">
                   <span className="opacity-70 group-hover:opacity-100">{CAPABILITY_META[cap].icon}</span>
                   <span>{t(`capabilities.${cap}.label`)}</span>
                </div>
                {active && <Check className="size-3.5" />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function FilterLens({ filters, onFiltersChange, totalModels, filteredCount, className }: FilterLensProps) {
  const t = useTranslations("models");
  const [localSearch, setLocalSearch] = React.useState(filters.search);
  const debouncedSearch = useDebounce(localSearch, 300);

  React.useEffect(() => {
    if (debouncedSearch !== filters.search) {
      onFiltersChange({ ...filters, search: debouncedSearch });
    }
  }, [debouncedSearch, filters, onFiltersChange]);

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
  };

  return (
    <div className={cn(
      "sticky top-0 z-30 rounded-[20px] border border-[var(--hairline)] bg-[var(--panel-bg)]/88 px-3 py-3 shadow-[0_18px_40px_-32px_rgba(15,17,28,0.22)] backdrop-blur-xl", 
      className
    )}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative group min-w-0 flex-1 lg:max-w-md">
          <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[var(--ink-4)] transition-colors group-focus-within:text-[var(--accent-strong)]" />
          <Input 
            placeholder={t("filter.searchPlaceholder")} 
            value={localSearch} 
            onChange={(event) => setLocalSearch(event.target.value)} 
            className="ws-control h-10 rounded-xl border-[var(--hairline)] bg-[var(--panel-bg-inset)]/55 pl-9 pr-8 text-xs transition-all focus:border-[var(--accent-border)] focus:ring-1 focus:ring-[var(--accent-soft)]" 
          />
          {localSearch && (
            <button onClick={() => { setLocalSearch(""); onFiltersChange({ ...filters, search: "" }); }} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--ink-4)] transition-colors hover:text-[var(--danger)]">
              <X className="size-3.5" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <CapabilityFilter selected={filters.capabilities} onToggle={handleCapabilityToggle} />
          
          <Popover>
            <PopoverTrigger asChild>
              <button className={cn(
                "ws-control flex h-9 items-center gap-2 rounded-xl border px-3.5",
                filters.min_context_window || filters.active_only || filters.price_tier
                  ? "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-ink)] font-bold"
                  : "border-[var(--hairline)] bg-[var(--panel-bg)] text-[var(--ink-3)] hover:bg-[var(--panel-bg-inset)]"
              )}>
                <Filter className="size-3.5" />
                <span className="text-[11px] tracking-tight">Refine</span>
                <ChevronDown className="size-3 opacity-50" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-72 ws-bezel-inner border-[var(--hairline-strong)] p-4 shadow-2xl" align="start">
              <div className="space-y-4">
                 <div className="space-y-2">
                    <Label className="ws-meta text-[9px] uppercase tracking-widest opacity-60">Context Window</Label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {CONTEXT_WINDOW_PRESETS.map((preset) => (
                        <button
                          key={preset.label}
                          onClick={() => onFiltersChange({ ...filters, min_context_window: filters.min_context_window === preset.value ? null : preset.value })}
                          className={cn(
                            "ws-num rounded-md border px-2 py-1.5 text-[10px] transition-all",
                            filters.min_context_window === preset.value 
                              ? "border-[var(--accent-border)] bg-[var(--accent-soft)] font-bold text-[var(--accent-ink)]" 
                              : "border-[var(--hairline)] hover:bg-[var(--panel-bg-inset)]"
                          )}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                 </div>
                 
                 <Separator className="bg-[var(--hairline-subtle)]" />
                 
                 <div className="flex items-center justify-between">
                    <Label className="ws-control text-xs">Active Only</Label>
                    <Switch checked={filters.active_only} onCheckedChange={(checked) => onFiltersChange({ ...filters, active_only: checked })} className="data-[state=checked]:bg-[var(--accent-strong)] scale-75" />
                 </div>

                 <div className="space-y-2">
                    <Label className="ws-meta text-[9px] uppercase tracking-widest opacity-60">Price Tier</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {(["cheap", "moderate", "expensive", "premium"] as PriceTier[]).map((tier) => (
                        <button
                          key={tier}
                          onClick={() => onFiltersChange({ ...filters, price_tier: filters.price_tier === tier ? null : tier })}
                          className={cn(
                            "ws-control rounded-md border px-2 py-1 text-[10px] capitalize",
                            filters.price_tier === tier
                              ? "border-[var(--accent-border)] bg-[var(--accent-soft)] font-bold text-[var(--accent-ink)]"
                              : "border-[var(--hairline)] text-[var(--ink-3)] hover:bg-[var(--panel-bg-inset)]"
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

          {hasActiveFilters && (
            <button onClick={handleClearFilters} className="ws-control flex h-9 items-center gap-1.5 rounded-xl px-3 text-[11px] font-semibold text-[var(--ink-4)] transition-all hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]">
              <X className="size-3" />
              Reset
            </button>
          )}
        </div>

        <div className="flex items-center gap-3 lg:ml-auto lg:pl-2">
          <div className="rounded-xl border border-[var(--hairline)] bg-[var(--panel-bg-inset)] px-3 py-2">
            <div className="flex items-baseline gap-2">
              <span className="ws-num text-[14px] font-bold leading-none text-[var(--ink)]">{filteredCount}</span>
              <span className="ws-meta text-[9px] uppercase tracking-[0.18em] opacity-45">Visible</span>
            </div>
          </div>
          <div className="rounded-xl border border-[var(--hairline)] bg-[var(--panel-bg)] px-3 py-2">
            <div className="flex items-baseline gap-2">
              <span className="ws-num text-[14px] font-medium leading-none text-[var(--ink-3)]">{totalModels}</span>
              <span className="ws-meta text-[9px] uppercase tracking-[0.18em] opacity-35">Total</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Separator({ className }: { className?: string }) {
  return <div className={cn("h-px w-full", className)} />;
}
