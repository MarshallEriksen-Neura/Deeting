"use client";

import { motion } from "framer-motion";
import { Settings2, Shield, Trash2, Workflow, AlertCircle, CheckCircle2, Circle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/shadcn/badge";
import { Card } from "@/components/ui/shadcn/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/shadcn/tooltip";
import { cn } from "@/lib/utils";
import type { LocalSkillRuntimeStatus, PluginMarketSkillItem } from "@/lib/api/plugin-market";

const COLOR_OPTIONS = [
  "from-[#6D5CFF] to-[#A6B0FF]", // accent
  "from-[#1F9566] to-[#5BDFA0]", // ok
  "from-[#2A7FFF] to-[#6FB0FF]", // info
  "from-[#C48312] to-[#F1B85A]", // warn
  "from-[#D4476A] to-[#FF7A9A]", // danger
];

function pickColor(id: string) {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) % 10000;
  }
  return COLOR_OPTIONS[hash % COLOR_OPTIONS.length];
}

interface PluginCardProps {
  plugin: PluginMarketSkillItem;
  runtimeStatus?: LocalSkillRuntimeStatus | null;
  onInstall?: (plugin: PluginMarketSkillItem) => void;
  onUninstall?: (skillId: string) => void;
  onConfigure?: (plugin: PluginMarketSkillItem) => void;
}

export function PluginCard({
  plugin,
  runtimeStatus,
  onInstall,
  onUninstall,
  onConfigure,
}: PluginCardProps) {
  const t = useTranslations("plugins");
  const color = pickColor(plugin.id);
  
  const isReady = runtimeStatus?.runnable_now;
  const isInstalling = runtimeStatus?.runtime_install_state === "installing";
  const needsAction = runtimeStatus && !isReady && !isInstalling;

  const surfaceLabel = runtimeStatus == null ? null : t(`runtimeLabels.executionSurface.${runtimeStatus.normalized_execution_surface}`);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="group relative rounded-[18px] p-[6px] bg-[var(--panel-bg-inset)] ring-1 ring-[var(--hairline)] hover:ring-[var(--hairline-strong)] transition-all duration-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
    >
      <Card className="relative flex flex-col overflow-hidden border-0 py-0 rounded-[12px] bg-[var(--panel-bg)] ring-1 ring-[var(--hairline)] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] h-full">
        {/* Top Accent Strip */}
        <div className={cn("absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r opacity-60 group-hover:opacity-100 transition-opacity", color)} />

        <div className="flex flex-col p-4 gap-3 h-full">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-[10px] border shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] bg-[var(--panel-bg-inset)] border-[var(--hairline)]",
                isReady && "bg-[var(--ok-soft)] border-[var(--ok-border)]"
              )}>
                <Workflow className={cn("size-5", isReady ? "text-[var(--ok)]" : "text-[var(--ink-3)]")} strokeWidth={1.5} />
              </div>
              <div className="min-w-0">
                <h3 className="truncate text-[14px] font-[600] tracking-[-0.1px] text-[var(--ink)]">
                  {plugin.name}
                </h3>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {isReady ? (
                    <span className="flex items-center gap-1 text-[10px] font-[600] uppercase tracking-[0.04em] text-[var(--ok)]">
                      <CheckCircle2 size={10} /> {t("runtimeStatus.ready")}
                    </span>
                  ) : isInstalling ? (
                    <span className="flex items-center gap-1 text-[10px] font-[600] uppercase tracking-[0.04em] text-[var(--info)] animate-pulse">
                      <RefreshCw size={10} className="animate-spin" /> {t("runtimeStatus.installing")}
                    </span>
                  ) : needsAction ? (
                    <span className="flex items-center gap-1 text-[10px] font-[600] uppercase tracking-[0.04em] text-[var(--warn)]">
                      <AlertCircle size={10} /> {t("runtimeStatus.installRequired")}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[10px] font-[600] uppercase tracking-[0.04em] text-[var(--ink-4)]">
                      <Circle size={10} /> {t("status.disabled")}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-col items-end gap-1.5 shrink-0">
              <span className="font-mono tabular-nums text-[10px] text-[var(--ink-3)] bg-[var(--panel-bg-inset)] px-1.5 py-0.5 rounded-[4px] ring-1 ring-[var(--hairline)]">
                v{plugin.version ?? runtimeStatus?.installed_version ?? "0.0.0"}
              </span>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1">
            <p className="line-clamp-2 text-[12px] leading-[1.5] text-[var(--ink-2)] min-h-[36px]">
              {plugin.description || t("card.noDescription")}
            </p>
            
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-[6px] bg-[var(--panel-bg-inset)] p-1.5 ring-1 ring-[var(--hairline)] flex flex-col gap-0.5">
                <span className="text-[9px] uppercase tracking-[0.1em] text-[var(--ink-4)] font-[600]">{t("page.skills.surfaceLabel")}</span>
                <span className="text-[11px] font-[500] text-[var(--ink-2)] truncate">{surfaceLabel ?? "—"}</span>
              </div>
              <div className="rounded-[6px] bg-[var(--panel-bg-inset)] p-1.5 ring-1 ring-[var(--hairline)] flex flex-col gap-0.5">
                <span className="text-[9px] uppercase tracking-[0.1em] text-[var(--ink-4)] font-[600]">ID</span>
                <span className="text-[11px] font-mono text-[var(--ink-3)] truncate tracking-tighter">{plugin.id}</span>
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="mt-auto pt-3 border-t border-[var(--hairline)] flex items-center justify-between">
            <div className="flex items-center gap-1.5">
               <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="text-[var(--ink-4)] hover:text-[var(--ink-2)] transition-colors cursor-help">
                      <Shield size={14} />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent className="text-[10px] bg-[var(--panel-bg)] text-[var(--ink)] ring-1 ring-[var(--hairline-strong)]">
                    {t("card.permissions")}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>

            <div className="flex items-center gap-1">
              {plugin.installed && runtimeStatus && onConfigure && (
                <button
                  onClick={() => onConfigure?.(plugin)}
                  className="flex h-[26px] items-center gap-1.5 rounded-[6px] bg-[var(--panel-bg-inset)] px-2.5 text-[11px] font-[500] text-[var(--ink-2)] ring-1 ring-[var(--hairline)] hover:bg-[var(--panel-bg)] hover:text-[var(--ink)] hover:ring-[var(--hairline-strong)] transition-all active:translate-y-[1px]"
                >
                  <Settings2 size={12} />
                  {t("card.configure")}
                </button>
              )}
              {plugin.installed && onUninstall && (
                <button
                  onClick={() => onUninstall?.(plugin.id)}
                  className="flex h-[26px] w-[26px] items-center justify-center rounded-[6px] text-[var(--ink-4)] hover:text-[var(--danger)] hover:bg-[var(--danger-soft)] transition-all"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
