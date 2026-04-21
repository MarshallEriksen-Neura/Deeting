"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { RefreshCw, Settings, Cloud, Server, Cpu, AlertCircle, HelpCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { GlassCard } from "@/components/ui/common/glass-card";
import { GlassButton } from "@/components/ui/common/glass-button";
import { Badge } from "@/components/ui/shadcn/badge";
import type { ProviderInstance, ProviderStatus, SyncState } from "./types";

interface InstanceDashboardProps {
  instance: ProviderInstance;
  syncState?: SyncState;
  onSync: () => void;
  onSettings?: () => void;
  className?: string;
}

const PROVIDER_THEMES: Record<string, { color: string; icon: React.ReactNode }> = {
  openai: { color: "#10a37f", icon: <Cloud className="size-5" /> },
  anthropic: { color: "#d97706", icon: <Cloud className="size-5" /> },
  google: { color: "#4285f4", icon: <Cloud className="size-5" /> },
  ollama: { color: "#7c3aed", icon: <Server className="size-5" /> },
  azure: { color: "#0078d4", icon: <Cloud className="size-5" /> },
  default: { color: "#7c6dff", icon: <Cpu className="size-5" /> },
};

function StatusIndicator({ status, latency }: { status?: ProviderStatus; latency?: number }) {
  const t = useTranslations("models");
  const safeLatency = Number.isFinite(latency ?? NaN) ? (latency as number) : 0;
  const statusConfig: Record<ProviderStatus, { color: string; bgColor: string; label: string; pulse: boolean; icon?: React.ReactNode }> = {
    online: { color: "text-emerald-500", bgColor: "bg-emerald-500", label: t("status.online", { latency: safeLatency }), pulse: true },
    offline: { color: "text-red-500", bgColor: "bg-red-500", label: t("status.offline"), pulse: false },
    degraded: { color: "text-yellow-500", bgColor: "bg-yellow-500", label: t("status.degraded", { latency: safeLatency }), pulse: true },
    syncing: { color: "text-blue-500", bgColor: "bg-blue-500", label: t("status.syncing"), pulse: true },
    unknown: { color: "text-slate-500", bgColor: "bg-slate-400/70", label: t("status.unknown"), pulse: false, icon: <HelpCircle className="size-3.5" /> },
  };
  const config = statusConfig[status && statusConfig[status] ? status : "unknown"];

  return (
    <div className="flex items-center gap-2">
      <span className="relative flex size-2.5">
        {config.pulse ? <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-75", config.bgColor)} /> : null}
        <span className={cn("relative inline-flex size-2.5 rounded-full", config.bgColor)} />
      </span>
      <span className={cn("inline-flex items-center gap-1.5 text-sm font-medium", config.color)}>
        {config.icon}
        <span>{config.label}</span>
      </span>
    </div>
  );
}

function SyncButton({ syncState, onSync }: { syncState: SyncState; onSync: () => void }) {
  const t = useTranslations("models");
  return (
    <GlassButton variant="secondary" size="default" onClick={onSync} disabled={syncState.is_syncing} className="gap-2">
      <motion.div animate={syncState.is_syncing ? { rotate: 360 } : { rotate: 0 }} transition={syncState.is_syncing ? { duration: 1, repeat: Infinity, ease: "linear" } : { duration: 0 }}>
        <RefreshCw className="size-4" />
      </motion.div>
      <span>{syncState.is_syncing ? t("instance.syncing") : t("instance.syncModels")}</span>
    </GlassButton>
  );
}

export function InstanceDashboard({ instance, syncState, onSync, onSettings, className }: InstanceDashboardProps) {
  const t = useTranslations("models");
  const providerKey = instance.provider ?? instance.provider_display_name ?? instance.preset_slug ?? instance.name ?? "default";
  const theme = PROVIDER_THEMES[providerKey.toLowerCase()] || PROVIDER_THEMES.default;
  const safeSyncState = syncState ?? { is_syncing: false, progress: 0, last_sync: null, error: null };

  const formatLastSynced = (timestamp?: string) => {
    if (!timestamp) return t("instance.neverSynced");
    const date = new Date(timestamp);
    const diffMs = Date.now() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return t("instance.justNow");
    if (diffMins < 60) return t("instance.ago", { time: `${diffMins}m` });
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return t("instance.ago", { time: `${diffHours}h` });
    return date.toLocaleDateString();
  };

  return (
    <GlassCard className={cn("relative overflow-hidden", className)} padding="none" hover="none" blur="lg">
      <div className="relative z-10 flex flex-col justify-between gap-6 p-6 md:flex-row md:items-center">
        <div className="flex items-center gap-4">
          <div className="flex size-14 items-center justify-center rounded-2xl border border-white/10 shadow-lg" style={{ background: `linear-gradient(135deg, ${theme.color}30 0%, ${theme.color}10 100%)`, boxShadow: `0 8px 32px -8px ${theme.color}40` }}>
            <div style={{ color: theme.color }}>{theme.icon}</div>
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-[var(--foreground)]">{instance.name}</h1>
              {!instance.is_enabled ? <Badge variant="outline" className="border-yellow-500/30 text-yellow-500">{t("instance.disabled")}</Badge> : null}
            </div>
            <p className="font-mono text-sm text-[var(--muted)]">{instance.base_url}</p>
            <div className="mt-1 flex items-center gap-4">
              <StatusIndicator status={instance.status} latency={instance.latency} />
              <span className="text-xs text-[var(--muted)]">{t("filter.modelsCount", { count: instance.model_count ?? 0 })}</span>
              <span className="text-xs text-[var(--muted)]">{t("instance.synced", { time: formatLastSynced(instance.last_synced_at) })}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {safeSyncState.is_syncing ? (
            <div className="mr-4 flex items-center gap-2">
              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-white/10">
                <motion.div className="h-full rounded-full" style={{ backgroundColor: theme.color }} initial={{ width: 0 }} animate={{ width: `${safeSyncState.progress}%` }} transition={{ duration: 0.3 }} />
              </div>
              <span className="text-xs text-[var(--muted)]">{safeSyncState.progress}%</span>
            </div>
          ) : null}
          <SyncButton syncState={safeSyncState} onSync={onSync} />
          <GlassButton variant="ghost" size="icon" onClick={onSettings} className="hover:bg-white/5">
            <Settings className="size-4" />
          </GlassButton>
        </div>
      </div>
      {safeSyncState.error ? (
        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} className="border-t border-red-500/20 bg-red-500/10 px-6 py-3">
          <div className="flex items-center gap-2 text-sm text-red-400">
            <AlertCircle className="size-4" />
            <span>{safeSyncState.error}</span>
          </div>
        </motion.div>
      ) : null}
    </GlassCard>
  );
}
