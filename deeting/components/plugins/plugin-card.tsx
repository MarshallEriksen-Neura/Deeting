"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  Settings2,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  CircleDashed,
  BookOpen,
  Terminal,
  Plug,
  Sparkles,
  Cpu,
  Box,
  SlidersHorizontal,
  Variable,
  Layers,
  ChevronRight,
} from "lucide-react";
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

type ToneKey = "ready" | "installing" | "action" | "disabled";

const TONE: Record<
  ToneKey,
  {
    iconBg: string;
    iconText: string;
    iconRing: string;
    dot: string;
    text: string;
    accentRail: string;
  }
> = {
  ready: {
    iconBg:
      "bg-gradient-to-br from-[color-mix(in_oklch,var(--ok)_22%,var(--panel-bg))] to-[var(--ok-soft)]",
    iconText: "text-[var(--ok)]",
    iconRing: "ring-[var(--ok-border)]",
    dot: "bg-[var(--ok)] shadow-[0_0_0_3px_color-mix(in_oklch,var(--ok)_22%,transparent)]",
    text: "text-[var(--ok)]",
    accentRail:
      "bg-gradient-to-r from-transparent via-[color-mix(in_oklch,var(--ok)_38%,transparent)] to-transparent",
  },
  installing: {
    iconBg:
      "bg-gradient-to-br from-[color-mix(in_oklch,var(--info)_22%,var(--panel-bg))] to-[var(--info-soft)]",
    iconText: "text-[var(--info)]",
    iconRing: "ring-[var(--info-border)]",
    dot: "bg-[var(--info)] shadow-[0_0_0_3px_color-mix(in_oklch,var(--info)_22%,transparent)]",
    text: "text-[var(--info)]",
    accentRail:
      "bg-gradient-to-r from-transparent via-[color-mix(in_oklch,var(--info)_38%,transparent)] to-transparent",
  },
  action: {
    iconBg:
      "bg-gradient-to-br from-[color-mix(in_oklch,var(--warn)_22%,var(--panel-bg))] to-[var(--warn-soft)]",
    iconText: "text-[var(--warn)]",
    iconRing: "ring-[var(--warn-border)]",
    dot: "bg-[var(--warn)] shadow-[0_0_0_3px_color-mix(in_oklch,var(--warn)_22%,transparent)]",
    text: "text-[var(--warn)]",
    accentRail:
      "bg-gradient-to-r from-transparent via-[color-mix(in_oklch,var(--warn)_38%,transparent)] to-transparent",
  },
  disabled: {
    iconBg: "bg-[var(--panel-bg-inset)]",
    iconText: "text-[var(--ink-3)]",
    iconRing: "ring-[var(--hairline)]",
    dot: "bg-[var(--ink-4)]",
    text: "text-[var(--ink-3)]",
    accentRail: "bg-transparent",
  },
};

const ECO_LABEL_OVERRIDES: Record<string, string> = {
  python: "Python",
  node: "Node.js",
  nodejs: "Node.js",
  npm: "Node.js",
  rust: "Rust",
  shell: "Shell",
  bash: "Shell",
};

function formatEcosystem(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "unknown") return null;
  const lower = trimmed.toLowerCase();
  if (ECO_LABEL_OVERRIDES[lower]) return ECO_LABEL_OVERRIDES[lower];
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}

function pickIcon(adapterKind?: string, ecosystem?: string) {
  if (adapterKind === "docs_bundle") return BookOpen;
  if (adapterKind === "openclaw_script") return Terminal;
  if (adapterKind === "deeting_tool_binding") return Plug;
  const eco = (ecosystem ?? "").toLowerCase();
  if (eco.includes("python") || eco.includes("node") || eco.includes("rust")) return Box;
  return Sparkles;
}

export function PluginCard({
  plugin,
  runtimeStatus,
  onUninstall,
  onConfigure,
}: PluginCardProps) {
  const t = useTranslations("plugins");

  const isReady = Boolean(runtimeStatus?.runnable_now);
  const isInstalling = runtimeStatus?.runtime_install_state === "installing";
  const isExplicitlyDisabled = Boolean(runtimeStatus && !runtimeStatus.is_enabled && !isInstalling);
  const needsAction = Boolean(
    runtimeStatus && !isReady && !isInstalling && !isExplicitlyDisabled
  );

  const tone: ToneKey = isReady
    ? "ready"
    : isInstalling
      ? "installing"
      : needsAction
        ? "action"
        : "disabled";

  const styles = TONE[tone];

  const statusLabel = isReady
    ? t("runtimeStatus.ready")
    : isInstalling
      ? t("runtimeStatus.installing")
      : needsAction
        ? t("runtimeStatus.installRequired")
        : t("status.disabled");

  const StatusIcon = isReady
    ? CheckCircle2
    : isInstalling
      ? Loader2
      : needsAction
        ? AlertTriangle
        : CircleDashed;

  // Meta — only show pills when the data is meaningful
  const surfaceKey = runtimeStatus?.normalized_execution_surface;
  const adapterKey = runtimeStatus?.adapter_kind;
  const ecosystemLabel = formatEcosystem(runtimeStatus?.ecosystem);
  const surfaceLabel = surfaceKey ? t(`runtimeLabels.executionSurface.${surfaceKey}`) : null;
  const adapterLabel =
    adapterKey && adapterKey !== "unknown" ? t(`runtimeLabels.adapterKind.${adapterKey}`) : null;

  const Icon = pickIcon(runtimeStatus?.adapter_kind, runtimeStatus?.ecosystem);

  // Requirements summary
  const requiredBins = runtimeStatus?.required_bins?.length ?? 0;
  const requiredEnv = runtimeStatus?.required_env?.length ?? 0;
  const requiredConfig = runtimeStatus?.required_config?.length ?? 0;
  const missingBins = runtimeStatus?.missing_bins?.length ?? 0;
  const missingEnv = runtimeStatus?.missing_env?.length ?? 0;
  const missingConfig = runtimeStatus?.missing_config?.length ?? 0;
  const totalRequired = requiredBins + requiredEnv + requiredConfig;
  const totalMissing = missingBins + missingEnv + missingConfig;
  const filled = Math.max(0, totalRequired - totalMissing);
  const showRequirements = totalRequired > 0;
  const fulfillRatio = totalRequired === 0 ? 1 : filled / totalRequired;

  // Blocking reason — only when card needs attention
  const blockingReasonText =
    needsAction && runtimeStatus?.blocking_reason
      ? t(`runtimeStatus.reason.${runtimeStatus.blocking_reason}`)
      : null;

  const versionStr = plugin.version ?? runtimeStatus?.installed_version ?? null;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
      className="group relative h-full"
    >
      <Card
        className={cn(
          "relative flex h-full flex-col overflow-hidden rounded-[18px] border-0 bg-[var(--panel-bg)] py-0 ring-1 ring-[var(--hairline)]",
          "shadow-[0_1px_2px_rgba(15,17,28,0.04),inset_0_1px_0_rgba(255,255,255,0.55)]",
          "transition-all duration-[var(--dur-medium)] ease-[var(--ease-standard)]",
          "hover:-translate-y-0.5 hover:ring-[var(--hairline-strong)]",
          "hover:shadow-[0_8px_28px_-10px_rgba(15,17,28,0.16),inset_0_1px_0_rgba(255,255,255,0.7)]"
        )}
      >
        {/* Subtle top accent rail — single chromatic cue */}
        <div className={cn("pointer-events-none absolute inset-x-0 top-0 h-[1.5px] opacity-0 transition-opacity duration-[var(--dur-medium)] group-hover:opacity-100", styles.accentRail)} />

        {/* ─── Hero ─── */}
        <div className="flex flex-col gap-3.5 px-5 pt-5 pb-4">
          <div className="flex items-start gap-3.5">
            {/* Icon tile — primary chromatic cue, iOS-style tinted glyph */}
            <motion.div
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.96 }}
              transition={{ type: "spring", stiffness: 500, damping: 28 }}
              className={cn(
                "relative flex size-[46px] shrink-0 items-center justify-center rounded-[14px] ring-1",
                "shadow-[inset_0_1px_0_rgba(255,255,255,0.45),inset_0_-1px_0_rgba(15,17,28,0.04)]",
                styles.iconBg,
                styles.iconRing
              )}
            >
              <Icon className={cn("size-[22px]", styles.iconText)} strokeWidth={1.6} />
            </motion.div>

            {/* Title block */}
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <h3 className="line-clamp-1 text-[15px] font-semibold leading-tight tracking-[-0.2px] text-[var(--ink)]">
                  {plugin.name}
                </h3>
                {versionStr && (
                  <span className="shrink-0 rounded-[6px] bg-[var(--panel-bg-inset)] px-1.5 py-[3px] font-mono text-[10px] font-medium leading-none tabular-nums text-[var(--ink-3)] ring-1 ring-[var(--hairline)]">
                    v{versionStr}
                  </span>
                )}
              </div>
              <p className="mt-1 truncate font-mono text-[10.5px] leading-tight text-[var(--ink-4)]">
                {runtimeStatus?.skill_id ?? plugin.id}
              </p>

              {/* Status row — soft, non-intrusive */}
              <div className="mt-2 flex items-center gap-1.5">
                <span
                  className={cn(
                    "size-[7px] shrink-0 rounded-full",
                    styles.dot,
                    isInstalling && "animate-pulse"
                  )}
                />
                <StatusIcon
                  size={11}
                  strokeWidth={2.2}
                  className={cn(styles.text, isInstalling && "animate-spin")}
                />
                <span
                  className={cn(
                    "text-[10.5px] font-semibold uppercase tracking-[0.06em]",
                    styles.text
                  )}
                >
                  {statusLabel}
                </span>
              </div>
            </div>
          </div>

          {/* Description (only when present) */}
          {plugin.description && (
            <p className="line-clamp-2 text-[12px] leading-[1.55] text-[var(--ink-2)]">
              {plugin.description}
            </p>
          )}
        </div>

        {/* ─── Meta pills ─── */}
        {(surfaceLabel || ecosystemLabel || adapterLabel) && (
          <div className="flex flex-wrap gap-1.5 px-5 pb-3">
            {surfaceLabel && (
              <MetaPill icon={<Cpu size={10} strokeWidth={2.2} />}>{surfaceLabel}</MetaPill>
            )}
            {ecosystemLabel && (
              <MetaPill icon={<Layers size={10} strokeWidth={2.2} />}>{ecosystemLabel}</MetaPill>
            )}
            {adapterLabel && <MetaPill subtle>{adapterLabel}</MetaPill>}
          </div>
        )}

        {/* ─── Requirements panel — iOS grouped row ─── */}
        {showRequirements && (
          <div className="mx-5 mb-3 overflow-hidden rounded-[12px] bg-[var(--panel-bg-inset)] ring-1 ring-inset ring-[var(--hairline-subtle)]">
            <div className="flex items-center justify-between px-3 pt-2.5 pb-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-3)]">
                {t("card.reqs.summary")}
              </span>
              <span
                className={cn(
                  "font-mono text-[10.5px] tabular-nums",
                  totalMissing === 0 ? "text-[var(--ok)]" : "text-[var(--warn)]"
                )}
              >
                {t("card.reqs.ratio", { filled, total: totalRequired })}
              </span>
            </div>

            {/* Progress bar — subtle iOS */}
            <div className="mx-3 h-[3px] overflow-hidden rounded-full bg-[var(--hairline)]">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${fulfillRatio * 100}%` }}
                transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1], delay: 0.05 }}
                className={cn(
                  "h-full rounded-full",
                  totalMissing === 0
                    ? "bg-gradient-to-r from-[var(--ok)] to-[color-mix(in_oklch,var(--ok)_70%,white)]"
                    : "bg-gradient-to-r from-[var(--warn)] to-[color-mix(in_oklch,var(--warn)_70%,white)]"
                )}
              />
            </div>

            {/* Three-up requirement chips */}
            <div className="grid grid-cols-3 gap-px bg-[var(--hairline-subtle)] mt-2.5 mx-px mb-px rounded-b-[11px] overflow-hidden">
              <ReqCell
                label={t("card.reqs.bins")}
                icon={<Box size={11} strokeWidth={2} />}
                missing={missingBins}
                required={requiredBins}
                emptyLabel={t("card.reqs.none")}
              />
              <ReqCell
                label={t("card.reqs.env")}
                icon={<Variable size={11} strokeWidth={2} />}
                missing={missingEnv}
                required={requiredEnv}
                emptyLabel={t("card.reqs.none")}
              />
              <ReqCell
                label={t("card.reqs.config")}
                icon={<SlidersHorizontal size={11} strokeWidth={2} />}
                missing={missingConfig}
                required={requiredConfig}
                emptyLabel={t("card.reqs.none")}
              />
            </div>
          </div>
        )}

        {/* ─── Blocker hint (action state) ─── */}
        {blockingReasonText && (
          <div className="mx-5 mb-3 flex items-start gap-2 rounded-[10px] bg-[var(--warn-soft)] px-3 py-2 ring-1 ring-inset ring-[var(--warn-border)]">
            <AlertTriangle
              size={12}
              className="mt-[2px] shrink-0 text-[var(--warn)]"
              strokeWidth={2.2}
            />
            <p className="line-clamp-2 text-[11px] leading-[1.45] text-[var(--ink)]">
              {blockingReasonText}
            </p>
          </div>
        )}

        {/* ─── Footer actions — iOS tinted button ─── */}
        <div className="mt-auto flex items-center gap-1.5 border-t border-[var(--hairline)] px-3 py-2.5">
          {plugin.installed && runtimeStatus && onConfigure ? (
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={() => onConfigure?.(plugin)}
              className={cn(
                "flex h-[32px] flex-1 items-center justify-center gap-1.5 rounded-[10px] px-3 text-[12px] font-semibold leading-none transition-all duration-[var(--dur-fast)]",
                "bg-[var(--accent-soft)] text-[var(--accent-ink)] ring-1 ring-inset ring-[color-mix(in_oklch,var(--accent-strong)_18%,transparent)]",
                "hover:bg-[color-mix(in_oklch,var(--accent-strong)_18%,transparent)] hover:ring-[var(--accent-border)]"
              )}
            >
              <Settings2 size={13} strokeWidth={2} />
              {t("card.configure")}
              <ChevronRight
                size={12}
                strokeWidth={2.2}
                className="-mr-0.5 opacity-60 transition-transform duration-[var(--dur-fast)] group-hover:translate-x-0.5"
              />
            </motion.button>
          ) : (
            <div className="flex-1" />
          )}
          {plugin.installed && onUninstall && (
            <motion.button
              whileTap={{ scale: 0.92 }}
              onClick={() => onUninstall?.(plugin.id)}
              aria-label={t("card.uninstall")}
              className={cn(
                "flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-[10px] text-[var(--ink-4)] transition-all duration-[var(--dur-fast)]",
                "hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] hover:ring-1 hover:ring-inset hover:ring-[var(--danger-border)]"
              )}
            >
              <Trash2 size={13} strokeWidth={2} />
            </motion.button>
          )}
        </div>
      </Card>
    </motion.div>
  );
}

/* ─── Sub-components ─── */

function MetaPill({
  icon,
  subtle,
  children,
}: {
  icon?: React.ReactNode;
  subtle?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[10.5px] font-medium leading-none ring-1",
        subtle
          ? "bg-transparent text-[var(--ink-3)] ring-[var(--hairline)]"
          : "bg-[var(--panel-bg-inset)] text-[var(--ink-2)] ring-[var(--hairline)]"
      )}
    >
      {icon && <span className="text-[var(--ink-3)]">{icon}</span>}
      <span className="truncate max-w-[140px]">{children}</span>
    </span>
  );
}

function ReqCell({
  icon,
  label,
  missing,
  required,
  emptyLabel,
}: {
  icon: React.ReactNode;
  label: string;
  missing: number;
  required: number;
  emptyLabel: string;
}) {
  if (required === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-0.5 bg-[var(--panel-bg-inset)] px-2 py-2 text-[10px] text-[var(--ink-4)]">
        <span className="opacity-60">{icon}</span>
        <span className="font-mono leading-none">{emptyLabel}</span>
        <span className="text-[9px] uppercase tracking-[0.06em] leading-none opacity-70">
          {label}
        </span>
      </div>
    );
  }

  const ok = missing === 0;
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-0.5 px-2 py-2 transition-colors",
        ok ? "bg-[var(--ok-soft)]" : "bg-[var(--warn-soft)]"
      )}
    >
      <span className={ok ? "text-[var(--ok)]" : "text-[var(--warn)]"}>{icon}</span>
      <span
        className={cn(
          "font-mono text-[11px] font-semibold leading-none tabular-nums",
          ok ? "text-[var(--ok)]" : "text-[var(--warn)]"
        )}
      >
        {ok ? `${required}` : `${missing}/${required}`}
      </span>
      <span
        className={cn(
          "text-[9px] uppercase tracking-[0.06em] leading-none",
          ok ? "text-[var(--ok)]" : "text-[var(--warn)]"
        )}
      >
        {label}
      </span>
    </div>
  );
}
