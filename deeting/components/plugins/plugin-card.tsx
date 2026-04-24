"use client";

import { motion } from "framer-motion";
import { Settings2, Trash2, Workflow, AlertCircle, CheckCircle2, Circle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/shadcn/card";
import { cn } from "@/lib/utils";
import type { LocalSkillRuntimeStatus, PluginMarketSkillItem } from "@/lib/api/plugin-market";

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
  onUninstall,
  onConfigure,
}: PluginCardProps) {
  const t = useTranslations("plugins");

  const isReady = runtimeStatus?.runnable_now;
  const isInstalling = runtimeStatus?.runtime_install_state === "installing";
  const needsAction = runtimeStatus && !isReady && !isInstalling;

  const tone = isReady
    ? { bar: "from-[var(--ok)] to-[#5BDFA0]", rail: "bg-[var(--ok)]", railGlow: "shadow-[0_0_0_1px_color-mix(in_oklch,var(--ok)_18%,transparent)]", icon: "bg-[var(--ok-soft)] border-[var(--ok-border)]", iconText: "text-[var(--ok)]" }
    : isInstalling
      ? { bar: "from-[var(--info)] to-[#6FB0FF]", rail: "bg-[var(--info)]", railGlow: "shadow-[0_0_0_1px_color-mix(in_oklch,var(--info)_18%,transparent)]", icon: "bg-[var(--info-soft)] border-[var(--info-border)]", iconText: "text-[var(--info)]" }
      : needsAction
        ? { bar: "from-[var(--warn)] to-[#F1B85A]", rail: "bg-[var(--warn)]", railGlow: "shadow-[0_0_0_1px_color-mix(in_oklch,var(--warn)_18%,transparent)]", icon: "bg-[var(--warn-soft)] border-[var(--warn-border)]", iconText: "text-[var(--warn)]" }
        : { bar: "from-[var(--chrome-bg)] to-[var(--panel-bg-inset)]", rail: "bg-[var(--ink-4)]", railGlow: "", icon: "bg-[var(--panel-bg-inset)] border-[var(--hairline)]", iconText: "text-[var(--ink-3)]" };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="group relative h-full"
    >
      <Card className="relative flex h-full flex-col overflow-hidden rounded-[calc(var(--r-18)-6px)] border-0 bg-[var(--panel-bg)] py-0 ring-1 ring-[var(--hairline)] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition-colors hover:bg-[var(--panel-bg-inset)]">
        {/* Top status bar */}
        <div className={cn("absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r opacity-60 transition-opacity group-hover:opacity-100", tone.bar)} />

        {/* Left status rail */}
        <div
          className={cn(
            "absolute left-0 top-1/2 h-[18px] w-[3px] -translate-y-1/2 rounded-r-full",
            tone.rail,
            tone.railGlow
          )}
        />

        <div className="flex flex-col gap-3 p-4 pl-5 h-full">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-[var(--r-10)] border shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]", tone.icon)}>
                <Workflow className={cn("size-5", tone.iconText)} strokeWidth={1.5} />
              </div>
              <div className="min-w-0">
                <h3 className="truncate text-[14px] font-semibold tracking-[-0.1px] text-[var(--ink)]">
                  {plugin.name}
                </h3>
                <div className="flex items-center gap-2 mt-0.5">
                  {isReady ? (
                    <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--ok)]">
                      <CheckCircle2 size={10} /> {t("runtimeStatus.ready")}
                    </span>
                  ) : isInstalling ? (
                    <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--info)] animate-pulse">
                      <Circle size={10} className="animate-pulse" /> {t("runtimeStatus.installing")}
                    </span>
                  ) : needsAction ? (
                    <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--warn)]">
                      <AlertCircle size={10} /> {t("runtimeStatus.installRequired")}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--ink-4)]">
                      <Circle size={10} /> {t("status.disabled")}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <span className="shrink-0 font-mono text-[10px] tabular-nums text-[var(--ink-3)] bg-[var(--panel-bg-inset)] px-1.5 py-0.5 rounded-[var(--r-4)] ring-1 ring-[var(--hairline)]">
              v{plugin.version ?? runtimeStatus?.installed_version ?? "0.0.0"}
            </span>
          </div>

          {/* Body — description only when available */}
          {plugin.description && (
            <p className="line-clamp-2 text-[12px] leading-[1.5] text-[var(--ink-2)]">
              {plugin.description}
            </p>
          )}

          {/* Footer Actions */}
          <div className="mt-auto flex items-center justify-between border-t border-[var(--hairline)] pt-3">
            <div className="flex items-center gap-1.5">
              {/* placeholder for left-side info if needed */}
            </div>

            <div className="flex items-center gap-1">
              {plugin.installed && runtimeStatus && onConfigure && (
                <button
                  onClick={() => onConfigure?.(plugin)}
                  className="flex h-[26px] items-center gap-1.5 rounded-[var(--r-6)] bg-[var(--panel-bg-inset)] px-2.5 text-[11px] font-medium text-[var(--ink-2)] ring-1 ring-[var(--hairline)] transition-all hover:bg-[var(--panel-bg)] hover:text-[var(--ink)] hover:ring-[var(--hairline-strong)] active:translate-y-px"
                >
                  <Settings2 size={12} />
                  {t("card.configure")}
                </button>
              )}
              {plugin.installed && onUninstall && (
                <button
                  onClick={() => onUninstall?.(plugin.id)}
                  className="flex h-[26px] w-[26px] items-center justify-center rounded-[var(--r-6)] text-[var(--ink-4)] transition-all hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
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
