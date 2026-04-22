"use client";

import * as React from "react";
import { Play, Lock, Eye, Zap } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/shadcn/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/shadcn/tooltip";
import type { ProviderModel, ModelCapability } from "./types";
import { CAPABILITY_META, formatPrice } from "./types";

interface ModelDataStripProps {
  model: ProviderModel;
  onTest: (model: ProviderModel) => void;
  onToggleActive: (model: ProviderModel, active: boolean) => void;
  onRowClick?: (model: ProviderModel) => void;
  isExpanded?: boolean;
  readOnly?: boolean;
}

function getModelStatusTone(model: ProviderModel) {
  if (model.is_locked) {
    return {
      label: "Locked",
      className: "border-[var(--warn-border)] bg-[var(--warn-soft)] text-[var(--warn)]",
    };
  }

  if (model.is_active) {
    return {
      label: "Active",
      className: "border-[var(--ok-border)] bg-[var(--ok-soft)] text-[var(--ok)]",
    };
  }

  return {
    label: "Disabled",
    className: "border-[var(--hairline)] bg-[var(--panel-bg-inset)] text-[var(--ink-3)]",
  };
}

function CapabilityIcons({ capabilities }: { capabilities: ModelCapability[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {capabilities.slice(0, 3).map((capability) => (
        <TooltipProvider key={capability}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span 
                className="flex h-6 min-w-0 items-center justify-center rounded-full border border-[var(--hairline)] bg-[var(--panel-bg-inset)] px-2.5 text-[10px] font-semibold text-[var(--ink-3)] transition-colors hover:border-[var(--hairline-strong)] hover:text-[var(--ink)]"
              >
                {CAPABILITY_META[capability].icon}
              </span>
            </TooltipTrigger>
            <TooltipContent className="ws-bezel-inner text-[10px] font-bold py-1 px-2 border-[var(--hairline-strong)]">
              {capability.toUpperCase()}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ))}
      {capabilities.length > 3 && (
        <span className="ws-num text-[10px] text-[var(--ink-4)] ml-1">+{capabilities.length - 3}</span>
      )}
    </div>
  );
}

export function ModelDataStrip({ 
  model, 
  onTest, 
  onToggleActive, 
  onRowClick, 
  isExpanded, 
  readOnly = false 
}: ModelDataStripProps) {
  const isLocked = model.is_locked === true;
  const stopPropagation = React.useCallback((e: React.SyntheticEvent) => e.stopPropagation(), []);
  const statusTone = getModelStatusTone(model);

  return (
    <div 
      onClick={() => onRowClick?.(model)}
      className={cn(
        "group relative grid cursor-pointer grid-cols-[minmax(0,1.9fr)_minmax(120px,0.95fr)_minmax(148px,1fr)_auto] items-center gap-4 px-5 py-4 transition-all md:px-6",
        !model.is_active && "bg-[var(--panel-bg-inset)]/20",
        isExpanded ? "bg-[var(--accent-soft)]/36 shadow-[inset_0_0_0_1px_var(--accent-border)]" : "hover:bg-[var(--panel-bg-inset)]/42"
      )}
    >
      {/* Indicator Rail */}
      {isExpanded && <div className="absolute left-0 top-3 bottom-3 w-1 rounded-r-full bg-[var(--accent-strong)] shadow-[0_0_8px_var(--accent-strong)]" />}

      {/* Primary Info */}
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
            <span className={cn(
               "ws-num truncate text-[14px] font-semibold transition-colors",
               model.is_active ? "text-[var(--ink)]" : "text-[var(--ink-3)]"
            )}>{model.id}</span>
            {isLocked && <Lock className="size-3 text-[var(--warn)]" />}
            {model.weight > 0 && <Zap className="size-3 text-[var(--ok)] fill-[var(--ok)] opacity-60" />}
            </div>
            <div className="mt-1 flex min-w-0 items-center gap-2">
              <span className="truncate text-[11px] font-medium text-[var(--ink-3)]">{model.display_name || "-"}</span>
              <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold", statusTone.className)}>
                {statusTone.label}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Metrics Columns */}
      <div className="hidden md:block">
        <CapabilityIcons capabilities={model.capabilities} />
      </div>

      <div className="hidden md:block">
         <div className="flex flex-col gap-1 rounded-2xl border border-[var(--hairline-subtle)] bg-[var(--panel-bg-inset)]/55 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
               <span className="ws-meta text-[8px] uppercase tracking-[0.16em] opacity-45">In</span>
               <span className="ws-num text-[11px] font-semibold text-[var(--ok)]">{formatPrice(model.pricing.input)}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
               <span className="ws-meta text-[8px] uppercase tracking-[0.16em] opacity-45">Out</span>
               <span className="ws-num text-[11px] font-semibold text-[var(--warn)]">{formatPrice(model.pricing.output)}</span>
            </div>
         </div>
      </div>

      {/* Actions */}
      <div className="ml-auto flex items-center gap-2 self-center">
        <div onClick={stopPropagation} className="hidden items-center sm:flex">
          <Switch 
            checked={model.is_active} 
            onCheckedChange={(checked) => onToggleActive(model, checked)}
            className="scale-90 data-[state=checked]:bg-[var(--accent-strong)]"
            disabled={readOnly || isLocked}
          />
        </div>
        
        <div className="flex items-center gap-1 opacity-100 transition-all md:opacity-0 md:group-hover:opacity-100">
          <button 
            onClick={(e) => { stopPropagation(e); onTest(model); }}
            className="rounded-xl p-2 text-[var(--accent-ink)] transition-colors hover:bg-[var(--accent-soft)]"
          >
            <Play className="size-3.5" />
          </button>

          <button 
            className="rounded-xl p-2 text-[var(--ink-3)] transition-colors hover:bg-[var(--panel-bg-inset)]"
          >
            <Eye className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

interface ModelMatrixProps {
  models: ProviderModel[];
  onTest: (model: ProviderModel) => void;
  onToggleActive: (model: ProviderModel, active: boolean) => void;
  readOnly?: boolean;
  selectedModelId?: string | null;
  className?: string;
  onRowClick?: (model: ProviderModel) => void;
}

export function ModelMatrix({ 
  models, 
  onTest, 
  onToggleActive, 
  readOnly = false, 
  selectedModelId = null,
  onRowClick,
  className 
}: ModelMatrixProps) {
  const t = useTranslations("models");
  
  return (
    <div className={cn("flex flex-col overflow-hidden rounded-[24px] border border-[var(--hairline)] bg-[var(--panel-bg)]", className)}>
      {/* Header */}
      <div className="grid grid-cols-[minmax(0,1.9fr)_minmax(120px,0.95fr)_minmax(148px,1fr)_auto] items-center gap-4 border-b border-[var(--hairline)] bg-[var(--panel-bg-inset)]/55 px-5 py-3 md:px-6">
        <div className="ws-meta text-[10px] tracking-[0.18em]">{t("list.header.id")}</div>
        <div className="hidden ws-meta text-[10px] tracking-[0.18em] md:block">{t("list.header.capabilities")}</div>
        <div className="hidden ws-meta text-[10px] tracking-[0.18em] md:block">{t("list.header.pricing")}</div>
        <div className="ws-meta text-right text-[10px] tracking-[0.18em]">Status</div>
      </div>

      <div className="flex flex-col divide-y divide-[var(--hairline-subtle)]">
        {models.map((model) => (
          <ModelDataStrip 
            key={model.id} 
            model={model} 
            onTest={onTest} 
            onToggleActive={onToggleActive} 
            readOnly={readOnly} 
            isExpanded={selectedModelId === model.id}
            onRowClick={onRowClick}
          />
        ))}
      </div>
    </div>
  );
}
