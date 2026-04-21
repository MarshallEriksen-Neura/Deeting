"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Play, Pencil, Check, X, AlertTriangle, Lock, Loader2, ShoppingCart, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { GlassCard } from "@/components/ui/common/glass-card";
import { GlassButton } from "@/components/ui/common/glass-button";
import { Badge } from "@/components/ui/shadcn/badge";
import { Switch } from "@/components/ui/shadcn/switch";
import { Input } from "@/components/ui/shadcn/input";
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
  const t = useTranslations("models");
  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex items-center gap-1">
        {capabilities.slice(0, 4).map((capability) => {
          const meta = CAPABILITY_META[capability];
          return (
            <Tooltip key={capability}>
              <TooltipTrigger asChild>
                <span className="flex size-6 cursor-default items-center justify-center rounded-md bg-white/5 text-[10px] font-semibold hover:bg-white/10 transition-colors">
                  {meta.icon}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                {t(`capabilities.${capability}.label`)}: {t(`capabilities.${capability}.description`)}
              </TooltipContent>
            </Tooltip>
          );
        })}
        {capabilities.length > 4 ? <span className="ml-1 text-xs text-[var(--muted)]">+{capabilities.length - 4}</span> : null}
      </div>
    </TooltipProvider>
  );
}

function ContextWindowBar({ tokens, maxTokens = 200000 }: { tokens: number; maxTokens?: number }) {
  const t = useTranslations("models");
  const percentage = Math.min((tokens / maxTokens) * 100, 100);
  const colorClass = percentage >= 60 ? "bg-emerald-500" : percentage >= 30 ? "bg-yellow-500" : "bg-[var(--primary)]";

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex min-w-[100px] items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
              <motion.div className={cn("h-full rounded-full", colorClass)} initial={{ width: 0 }} animate={{ width: `${percentage}%` }} transition={{ duration: 0.5, ease: "easeOut" }} />
            </div>
            <span className="min-w-[40px] text-xs font-mono text-[var(--muted)]">{formatContextWindow(tokens)}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {t("list.tooltips.contextWindow", { tokens: tokens.toLocaleString() })}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function PriceDisplay({ input, output }: { input: number; output: number }) {
  const t = useTranslations("models");
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-1 font-mono text-xs">
            <span className={getPriceColor(input)}>{formatPrice(input)}</span>
            <span className="text-[var(--muted)]">/</span>
            <span className={getPriceColor(output)}>{formatPrice(output)}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          <div className="space-y-1">
            <div>{t("list.tooltips.inputPrice", { price: formatPrice(input) })}</div>
            <div>{t("list.tooltips.outputPrice", { price: formatPrice(output) })}</div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function EditableAlias({ alias, onSave, readOnly = false }: { alias?: string; onSave: (alias: string) => void; readOnly?: boolean }) {
  const t = useTranslations("models");
  const [isEditing, setIsEditing] = React.useState(false);
  const [value, setValue] = React.useState(alias || "");
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSave = () => {
    onSave(value);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setValue(alias || "");
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div className="flex items-center gap-1">
        <Input ref={inputRef} value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => {
          if (event.key === "Enter") handleSave();
          if (event.key === "Escape") handleCancel();
        }} className="h-6 w-32 border-white/20 bg-white/5 px-2 text-xs" placeholder={t("list.actions.setAlias")} />
        <button onClick={handleSave} className="rounded p-1 text-emerald-500 hover:bg-emerald-500/10"><Check className="size-3" /></button>
        <button onClick={handleCancel} className="rounded p-1 text-[var(--muted)] hover:bg-white/5"><X className="size-3" /></button>
      </div>
    );
  }

  return (
    <div className="group/alias flex items-center gap-1">
      {alias ? <span className="text-xs text-[var(--muted)]">{alias}</span> : <span className="text-xs italic opacity-50 text-[var(--muted)]">{t("list.actions.noAlias")}</span>}
      <button disabled={readOnly} onClick={() => setIsEditing(true)} className="p-0.5 text-[var(--muted)] opacity-0 transition-opacity group-hover/alias:opacity-100 hover:text-[var(--foreground)] disabled:pointer-events-none disabled:opacity-20">
        <Pencil className="size-3" />
      </button>
    </div>
  );
}

export function ModelDataStrip({ model, index, onTest, onToggleActive, onUpdateAlias, onPurchase, onRowClick, isExpanded, readOnly = false, isPurchasing = false }: ModelDataStripProps) {
  const t = useTranslations("models");
  const isDeprecated = !!model.deprecated_at;
  const isLocked = model.is_locked === true;
  const effectiveReadOnly = readOnly || isLocked;
  const stopPropagation = React.useCallback((event: React.SyntheticEvent) => event.stopPropagation(), []);

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.03, duration: 0.3 }} exit={{ opacity: 0, x: -20 }} onClick={() => onRowClick?.(model)} role={onRowClick ? "button" : undefined} aria-expanded={isExpanded} className={onRowClick ? "cursor-pointer" : undefined}>
      <GlassCard className={cn("group relative transition-all duration-200", !model.is_active && "opacity-60", isDeprecated && "border-yellow-500/30")} padding="none" hover="none" blur="sm">
        <div className="pointer-events-none absolute inset-0 rounded-2xl border-2 border-transparent transition-colors duration-200 group-hover:border-[var(--primary)]/20" />
        {isDeprecated ? (
          <div className="absolute right-0 top-0 flex items-center gap-1 rounded-bl-lg rounded-tr-2xl bg-yellow-500/20 px-2 py-0.5 text-[10px] font-medium text-yellow-500">
            <AlertTriangle className="size-3" />
            {t("list.actions.deprecated")}
          </div>
        ) : null}
        <div className="flex items-center gap-4 p-4">
          <div className="flex max-w-[250px] min-w-[180px] flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <span className="truncate font-mono text-sm font-medium text-[var(--foreground)]">{model.id}</span>
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button onClick={(event) => { stopPropagation(event); void navigator.clipboard.writeText(model.id); }} className="p-0.5 text-[var(--muted)] opacity-0 transition-opacity group-hover:opacity-100 hover:text-[var(--foreground)]">
                      <Copy className="size-3" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">{t("list.actions.copyId")}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <EditableAlias alias={model.display_name} onSave={(alias) => onUpdateAlias(model, alias)} readOnly={effectiveReadOnly} />
            {isLocked ? (
              <div className="mt-1 flex items-center gap-2">
                <Badge variant="outline" className="h-5 border-amber-400/40 text-[10px] text-amber-300"><Lock className="mr-1 size-3" />{t("list.actions.locked")}</Badge>
                {typeof model.unlock_price_credits === "number" ? <span className="text-[10px] text-amber-200/90">{t("list.actions.unlockPrice", { price: model.unlock_price_credits })}</span> : null}
              </div>
            ) : null}
          </div>
          <div className="hidden min-w-[120px] md:block"><CapabilityIcons capabilities={model.capabilities} /></div>
          <div className="hidden min-w-[140px] lg:block"><ContextWindowBar tokens={model.context_window} /></div>
          <div className="hidden min-w-[100px] md:block"><PriceDisplay input={model.pricing.input} output={model.pricing.output} /></div>
          <div className="ml-auto flex items-center gap-3">
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center">
                    <Switch checked={model.is_active} onCheckedChange={(checked) => onToggleActive(model, checked)} onClick={stopPropagation} disabled={effectiveReadOnly} />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">{model.is_active ? t("list.actions.disable") : t("list.actions.enable")}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {isLocked && onPurchase ? (
              <GlassButton variant="default" size="sm" disabled={isPurchasing} onClick={(event) => { stopPropagation(event); onPurchase(model); }} className="gap-1.5 opacity-100">
                {isPurchasing ? <Loader2 className="size-3.5 animate-spin" /> : <ShoppingCart className="size-3.5" />}
                <span>{isPurchasing ? t("list.actions.purchasing") : t("list.actions.purchase")}</span>
              </GlassButton>
            ) : (
              <GlassButton variant="ghost" size="sm" disabled={effectiveReadOnly} onClick={(event) => { stopPropagation(event); onTest(model); }} className="gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 disabled:opacity-30">
                <Play className="size-3.5" />
                <span>{t("list.actions.test")}</span>
              </GlassButton>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-white/5 px-4 py-2 md:hidden">
          <CapabilityIcons capabilities={model.capabilities} />
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono text-[var(--muted)]">{formatContextWindow(model.context_window)}</span>
            <PriceDisplay input={model.pricing.input} output={model.pricing.output} />
          </div>
        </div>
      </GlassCard>
    </motion.div>
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
}

export function ModelMatrix({ models, onTest, onToggleActive, onUpdateAlias, onPurchase, readOnly = false, purchasingModelUuid = null, className }: ModelMatrixProps) {
  const t = useTranslations("models");
  return (
    <div className={cn("space-y-2", className)}>
      <div className="hidden items-center gap-4 px-4 py-2 text-xs font-medium uppercase tracking-wide text-[var(--muted)] lg:flex">
        <div className="max-w-[250px] min-w-[180px]">{t("list.header.id")}</div>
        <div className="min-w-[120px]">{t("list.header.capabilities")}</div>
        <div className="min-w-[140px]">{t("list.header.context")}</div>
        <div className="min-w-[100px]">{t("list.header.pricing")}</div>
        <div className="ml-auto">{t("list.header.status")}</div>
      </div>
      <AnimatePresence mode="popLayout">
        {models.map((model, index) => (
          <ModelDataStrip key={model.id} model={model} index={index} onTest={onTest} onToggleActive={onToggleActive} onUpdateAlias={onUpdateAlias} onPurchase={onPurchase} readOnly={readOnly} isPurchasing={purchasingModelUuid === model.uuid} />
        ))}
      </AnimatePresence>
    </div>
  );
}
