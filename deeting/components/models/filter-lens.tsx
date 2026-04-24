"use client";

import * as React from "react";
import { X, Filter, ChevronDown, Check, LayoutGrid } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
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
            {selected.length > 0
              ? t("filter.capabilitiesSelected", { count: selected.length })
              : t("filter.allCapabilities")}
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

  const hasActiveFilters = filters.capabilities.length > 0 || filters.min_context_window !== null || filters.active_only || filters.price_tier !== null;

  const handleCapabilityToggle = (capability: ModelCapability) => {
    const newCapabilities = filters.capabilities.includes(capability)
      ? filters.capabilities.filter((item) => item !== capability)
      : [...filters.capabilities, capability];
    onFiltersChange({ ...filters, capabilities: newCapabilities });
  };

  const handleClearFilters = () => {
    onFiltersChange({ search: "", capabilities: [], min_context_window: null, active_only: false, price_tier: null });
  };

  return (
    <div className={cn(
      "rounded-[var(--r-14)] border border-[var(--hairline)] bg-[var(--panel-bg)] px-3 py-2.5 shadow-sm",
      className
    )}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
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
                <span className="text-[11px] tracking-tight">{t("filter.refine")}</span>
                <ChevronDown className="size-3 opacity-50" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-72 ws-bezel-inner border-[var(--hairline-strong)] p-4 shadow-2xl" align="start">
              <div className="space-y-4">
                 <div className="space-y-2">
                    <Label className="ws-meta text-[9px] uppercase tracking-widest opacity-60">{t("filter.contextWindow")}</Label>
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
                    <Label className="ws-control text-xs">{t("filter.activeOnlyShort")}</Label>
                    <Switch checked={filters.active_only} onCheckedChange={(checked) => onFiltersChange({ ...filters, active_only: checked })} className="data-[state=checked]:bg-[var(--accent-strong)] scale-75" />
                 </div>

                 <div className="space-y-2">
                    <Label className="ws-meta text-[9px] uppercase tracking-widest opacity-60">{t("filter.priceTier")}</Label>
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
                          {t(`filter.priceTierOptions.${tier}`)}
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
              {t("filter.reset")}
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 lg:ml-auto">
          <div className="rounded-lg border border-[var(--hairline)] bg-[var(--panel-bg-inset)] px-2.5 py-1.5">
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono text-[13px] font-bold leading-none text-[var(--ink)]">{filteredCount}</span>
              <span className="text-[9px] font-medium uppercase tracking-[0.14em] text-[var(--ink-4)]">{t("filter.visible")}</span>
            </div>
          </div>
          <div className="rounded-lg border border-[var(--hairline)] bg-[var(--panel-bg)] px-2.5 py-1.5">
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono text-[13px] font-medium leading-none text-[var(--ink-3)]">{totalModels}</span>
              <span className="text-[9px] font-medium uppercase tracking-[0.14em] text-[var(--ink-4)]">{t("filter.total")}</span>
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
