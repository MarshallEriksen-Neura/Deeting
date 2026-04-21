"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
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
  onBatchUpdateCapabilities?: (capabilities: ModelCapability[]) => Promise<void>;
  className?: string;
}

function CapabilityFilter({ selected, onToggle }: { selected: ModelCapability[]; onToggle: (cap: ModelCapability) => void }) {
  const t = useTranslations("models");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className={cn(
          "ws-control flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all h-9",
          selected.length > 0 
            ? "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-ink)] font-bold" 
            : "border-[var(--hairline)] bg-[var(--panel-bg-inset)] text-[var(--ink-3)] hover:bg-[var(--panel-bg)]"
        )}>
          <LayoutGrid className="size-3.5" />
          <span className="text-[11px] uppercase tracking-tight">
            {selected.length > 0 ? `${selected.length} CAPABILITIES` : "ALL CAPABILITIES"}
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

export function FilterLens({ filters, onFiltersChange, totalModels, filteredCount, onBatchUpdateCapabilities, className }: FilterLensProps) {
  const t = useTranslations("models");
  const [localSearch, setLocalSearch] = React.useState(filters.search);
  const debouncedSearch = useDebounce(localSearch, 300);

  React.useEffect(() => {
    if (debouncedSearch !== filters.search) {
      onFiltersChange({ ...filters, search: debouncedSearch });
    }
  }, [debouncedSearch]);

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
      "flex flex-wrap items-center gap-3 py-2 px-1 border-b border-[var(--hairline-subtle)] bg-[var(--panel-bg)]/80 backdrop-blur-md sticky top-0 z-30", 
      className
    )}>
      {/* Compact Search */}
      <div className="relative w-full sm:w-64 group flex-none">
        <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[var(--ink-4)] group-focus-within:text-[var(--accent-strong)] transition-colors" />
        <Input 
          placeholder={t("filter.searchPlaceholder")} 
          value={localSearch} 
          onChange={(event) => setLocalSearch(event.target.value)} 
          className="ws-control h-8.5 border-[var(--hairline)] bg-[var(--panel-bg-inset)]/50 pl-9 pr-8 focus:border-[var(--accent-border)] focus:ring-1 focus:ring-[var(--accent-soft)] transition-all text-xs rounded-lg" 
        />
        {localSearch && (
          <button onClick={() => { setLocalSearch(""); onFiltersChange({ ...filters, search: "" }); }} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--ink-4)] hover:text-[var(--danger)] transition-colors">
            <X className="size-3.5" />
          </button>
        )}
      </div>
      
      {/* Filters Group */}
      <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
        <CapabilityFilter selected={filters.capabilities} onToggle={handleCapabilityToggle} />
        
        <Popover>
          <PopoverTrigger asChild>
            <button className={cn(
              "ws-control flex items-center gap-2 px-3 py-1.5 rounded-lg border h-9",
              filters.min_context_window || filters.active_only || filters.price_tier
                ? "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-ink)] font-bold"
                : "border-[var(--hairline)] bg-[var(--panel-bg-inset)] text-[var(--ink-3)] hover:bg-[var(--panel-bg)]"
            )}>
              <Filter className="size-3.5" />
              <span className="text-[11px] uppercase">Refine</span>
              <ChevronDown className="size-3 opacity-50" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-72 ws-bezel-inner p-4 shadow-2xl border-[var(--hairline-strong)]" align="start">
            <div className="space-y-4">
               <div className="space-y-2">
                  <Label className="ws-meta text-[9px] tracking-widest uppercase opacity-60">Context Window</Label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {CONTEXT_WINDOW_PRESETS.map((preset) => (
                      <button
                        key={preset.label}
                        onClick={() => onFiltersChange({ ...filters, min_context_window: filters.min_context_window === preset.value ? null : preset.value })}
                        className={cn(
                          "ws-num rounded-md px-2 py-1.5 text-[10px] border transition-all",
                          filters.min_context_window === preset.value 
                            ? "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-ink)] font-bold" 
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
                  <Label className="ws-meta text-[9px] tracking-widest uppercase opacity-60">Price Tier</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {(["cheap", "moderate", "expensive", "premium"] as PriceTier[]).map((tier) => (
                      <button
                        key={tier}
                        onClick={() => onFiltersChange({ ...filters, price_tier: filters.price_tier === tier ? null : tier })}
                        className={cn(
                          "ws-control rounded-md border px-2 py-1 text-[10px] capitalize",
                          filters.price_tier === tier
                            ? "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-ink)] font-bold"
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
          <button onClick={handleClearFilters} className="ws-control flex items-center gap-1.5 px-2 py-1.5 text-[10px] font-bold text-[var(--ink-4)] hover:text-[var(--danger)] transition-all">
            <X className="size-3" />
            RESET
          </button>
        )}
      </div>
      
      {/* Stats - Pushed to right */}
      <div className="ml-auto flex items-center gap-4 flex-none border-l border-[var(--hairline)] pl-4">
        <div className="flex flex-col items-end gap-0">
           <span className="ws-num text-[12px] font-bold text-[var(--ink)] leading-none">{filteredCount}</span>
           <span className="ws-meta text-[8px] opacity-40 uppercase tracking-tighter">Results</span>
        </div>
        <div className="flex flex-col items-end gap-0">
           <span className="ws-num text-[12px] font-medium text-[var(--ink-4)] leading-none">{totalModels}</span>
           <span className="ws-meta text-[8px] opacity-25 uppercase tracking-tighter">Total</span>
        </div>
      </div>
    </div>
  );
}

function Separator({ className }: { className?: string }) {
  return <div className={cn("h-px w-full", className)} />;
}
