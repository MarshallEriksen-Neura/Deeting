"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Play, Pencil, Check, X, AlertTriangle, Lock, Loader2, ShoppingCart, Copy, Eye, Zap } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/shadcn/badge";
import { Switch } from "@/components/ui/shadcn/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/shadcn/tooltip";
import type { ProviderModel, ModelCapability } from "./types";
import { CAPABILITY_META, formatContextWindow, formatPrice, getPriceColor } from "./types";

interface ModelDataStripProps {
  model: ProviderModel;
  index: number;
  onTest: (model: ProviderModel) => void;
  onToggleActive: (model: ProviderModel, active: boolean) => void;
  onUpdateAlias: (model: ProviderModel, alias: string) => void;
  onPurchase?: (model: ProviderModel) => void;
  onRowClick?: (model: ProviderModel) => void;
  isExpanded?: boolean;
  readOnly?: boolean;
  isPurchasing?: boolean;
}

function CapabilityIcons({ capabilities }: { capabilities: ModelCapability[] }) {
  return (
    <div className="flex items-center gap-1">
      {capabilities.slice(0, 3).map((capability) => (
        <TooltipProvider key={capability}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span 
                className="flex size-6 items-center justify-center rounded-lg bg-[var(--panel-bg-inset)] border border-[var(--hairline)] text-[10px] font-bold text-[var(--ink-3)] transition-colors hover:border-[var(--hairline-strong)] hover:text-[var(--ink)]"
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

function ContextWindowBar({ tokens, maxTokens = 200000 }: { tokens: number; maxTokens?: number }) {
  const percentage = Math.min((tokens / maxTokens) * 100, 100);
  return (
    <div className="flex min-w-[100px] items-center gap-3">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--panel-bg-inset)] border border-[var(--hairline-subtle)]">
        <motion.div 
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          className="h-full bg-[var(--accent-strong)] opacity-60 rounded-full" 
        />
      </div>
      <span className="ws-num text-[11px] text-[var(--ink-2)] font-medium w-10 text-right">{formatContextWindow(tokens)}</span>
    </div>
  );
}

export function ModelDataStrip({ 
  model, 
  index, 
  onTest, 
  onToggleActive, 
  onUpdateAlias, 
  onPurchase, 
  onRowClick, 
  isExpanded, 
  readOnly = false, 
  isPurchasing = false 
}: ModelDataStripProps) {
  const t = useTranslations("models");
  const isLocked = model.is_locked === true;
  const stopPropagation = React.useCallback((e: React.SyntheticEvent) => e.stopPropagation(), []);

  return (
    <div 
      onClick={() => onRowClick?.(model)}
      className={cn(
        "group relative flex items-center gap-6 px-6 py-3 transition-all cursor-pointer border-b border-[var(--hairline-subtle)]",
        !model.is_active && "bg-[var(--panel-bg-inset)]/20",
        isExpanded ? "bg-[var(--accent-soft)]/40 shadow-[inset_0_0_0_1px_var(--accent-border)]" : "hover:bg-[var(--panel-bg-inset)]/40"
      )}
    >
      {/* Indicator Rail */}
      {isExpanded && <div className="absolute left-0 top-3 bottom-3 w-1 bg-[var(--accent-strong)] rounded-r-full shadow-[0_0_8px_var(--accent-strong)]" />}

      {/* Primary Info */}
      <div className="flex flex-1 items-center gap-4 min-w-0">
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn(
               "ws-num text-[13px] font-bold truncate transition-colors",
               model.is_active ? "text-[var(--ink)]" : "text-[var(--ink-3)]"
            )}>{model.id}</span>
            {isLocked && <Lock className="size-3 text-[var(--warn)]" />}
            {model.weight > 0 && <Zap className="size-3 text-[var(--ok)] fill-[var(--ok)] opacity-60" />}
          </div>
          <span className="ws-caption truncate text-[11px] font-medium opacity-70">{model.display_name || "-"}</span>
        </div>
      </div>

      {/* Metrics Columns */}
      <div className="hidden w-28 md:block flex-none">
        <CapabilityIcons capabilities={model.capabilities} />
      </div>
      
      <div className="hidden w-36 lg:block flex-none">
        <ContextWindowBar tokens={model.context_window} />
      </div>

      <div className="hidden w-24 md:block flex-none">
         <div className="flex flex-col items-end gap-0.5">
            <div className="flex items-center gap-1">
               <span className="ws-meta text-[8px] opacity-40">IN</span>
               <span className="ws-num text-[11px] font-bold text-[var(--ok)]">{formatPrice(model.pricing.input)}</span>
            </div>
            <div className="flex items-center gap-1">
               <span className="ws-meta text-[8px] opacity-40">OUT</span>
               <span className="ws-num text-[11px] font-bold text-[var(--warn)]">{formatPrice(model.pricing.output)}</span>
            </div>
         </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 flex-none ml-auto">
        <div onClick={stopPropagation} className="flex items-center">
          <Switch 
            checked={model.is_active} 
            onCheckedChange={(checked) => onToggleActive(model, checked)}
            className="data-[state=checked]:bg-[var(--accent-strong)] scale-90"
            disabled={readOnly || isLocked}
          />
        </div>
        
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
          <button 
            onClick={(e) => { stopPropagation(e); onTest(model); }}
            className="p-1.5 rounded-lg hover:bg-[var(--accent-soft)] text-[var(--accent-ink)] transition-colors"
          >
            <Play className="size-4" />
          </button>

          <button 
            className="p-1.5 rounded-lg hover:bg-[var(--panel-bg-inset)] text-[var(--ink-3)] transition-colors"
          >
            <Eye className="size-4" />
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
  onUpdateAlias: (model: ProviderModel, alias: string) => void;
  onPurchase?: (model: ProviderModel) => void;
  readOnly?: boolean;
  purchasingModelUuid?: string | null;
  className?: string;
  onRowClick?: (model: ProviderModel) => void;
}

export function ModelMatrix({ 
  models, 
  onTest, 
  onToggleActive, 
  onUpdateAlias, 
  onPurchase, 
  readOnly = false, 
  purchasingModelUuid = null, 
  onRowClick,
  className 
}: ModelMatrixProps) {
  const t = useTranslations("models");
  
  return (
    <div className={cn("flex flex-col bg-[var(--panel-bg)] rounded-xl overflow-hidden border border-[var(--hairline)]", className)}>
      {/* Header */}
      <div className="flex items-center gap-6 px-6 py-2.5 bg-[var(--panel-bg-inset)]/50 border-b border-[var(--hairline)]">
        <div className="flex-1 ws-meta text-[10px] tracking-wider">{t("list.header.id")}</div>
        <div className="hidden w-28 md:block ws-meta text-[10px] tracking-wider">{t("list.header.capabilities")}</div>
        <div className="hidden w-36 lg:block ws-meta text-[10px] tracking-wider">{t("list.header.context")}</div>
        <div className="hidden w-24 md:block ws-meta text-[10px] tracking-wider text-right">{t("list.header.pricing")}</div>
        <div className="w-24 ws-meta text-[10px] tracking-wider text-right">OPERATIONS</div>
      </div>

      <div className="flex flex-col divide-y divide-[var(--hairline-subtle)]">
        {models.map((model, index) => (
          <ModelDataStrip 
            key={model.id} 
            model={model} 
            index={index} 
            onTest={onTest} 
            onToggleActive={onToggleActive} 
            onUpdateAlias={onUpdateAlias} 
            onPurchase={onPurchase} 
            readOnly={readOnly} 
            isPurchasing={purchasingModelUuid === model.uuid}
            onRowClick={onRowClick}
          />
        ))}
      </div>
    </div>
  );
}
