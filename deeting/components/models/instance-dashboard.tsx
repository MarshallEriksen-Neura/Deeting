"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { RefreshCw, Settings, Cloud, Server, Cpu, AlertCircle, HelpCircle, Activity, Globe, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
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
  openai: { color: "#10a37f", icon: <Cloud className="size-4" /> },
  anthropic: { color: "#d97706", icon: <Cloud className="size-4" /> },
  google: { color: "#4285f4", icon: <Cloud className="size-4" /> },
  ollama: { color: "#7c3aed", icon: <Server className="size-4" /> },
  azure: { color: "#0078d4", icon: <Cloud className="size-4" /> },
  default: { color: "var(--accent-strong)", icon: <Cpu className="size-4" /> },
};

function StatusIndicator({ status, latency }: { status?: ProviderStatus; latency?: number }) {
  const t = useTranslations("models");
  const safeLatency = Number.isFinite(latency ?? NaN) ? (latency as number) : 0;
  
  const statusConfig: Record<ProviderStatus, { tone: "ok" | "warn" | "danger" | "accent"; label: string; pulse: boolean }> = {
    online: { tone: "ok", label: t("status.online", { latency: safeLatency }), pulse: true },
    offline: { tone: "danger", label: t("status.offline"), pulse: false },
    degraded: { tone: "warn", label: t("status.degraded", { latency: safeLatency }), pulse: true },
    syncing: { tone: "accent", label: t("status.syncing"), pulse: true },
    unknown: { tone: "accent", label: t("status.unknown"), pulse: false },
  };
  
  const config = statusConfig[status && statusConfig[status] ? status : "unknown"];

  return (
    <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-[var(--panel-bg-inset)] border border-[var(--hairline)]">
      <div className="ws-dot" data-tone={config.tone} data-live={config.pulse} />
      <span className={cn(
        "ws-num text-[11px] font-semibold tracking-tight",
        config.tone === "ok" ? "text-[var(--ok)]" : 
        config.tone === "danger" ? "text-[var(--danger)]" :
        config.tone === "warn" ? "text-[var(--warn)]" : "text-[var(--accent-strong)]"
      )}>
        {config.label}
      </span>
    </div>
  );
}

export function InstanceDashboard({ instance, syncState, onSync, onSettings, className }: InstanceDashboardProps) {
  const t = useTranslations("models");
  const providerKey = instance.provider ?? instance.provider_display_name ?? instance.preset_slug ?? instance.name ?? "default";
  const theme = PROVIDER_THEMES[providerKey.toLowerCase()] || PROVIDER_THEMES.default;
  const safeSyncState = syncState ?? { is_syncing: false, progress: 0, last_sync: null, error: null };

  return (
    <div className={cn("ws-bezel group", className)}>
      <div className="ws-bezel-inner flex items-center justify-between gap-6 px-5 py-4">
        <div className="flex items-center gap-4 min-w-0">
          <div 
            className="flex size-12 flex-none items-center justify-center rounded-2xl border border-[var(--hairline-strong)] shadow-sm transition-transform group-hover:scale-105" 
            style={{ 
              backgroundColor: `color-mix(in oklch, ${theme.color} 8%, var(--panel-bg))`, 
              color: theme.color,
              boxShadow: `0 8px 16px -8px color-mix(in oklch, ${theme.color} 25%, transparent)`
            }}
          >
            {instance.icon ? (
              <img src={instance.icon} className="size-6 object-contain" alt="" />
            ) : theme.icon}
          </div>
          
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2.5">
              <h1 className="ws-pane-title text-[15px] tracking-tight">{instance.name}</h1>
              {instance.is_public && (
                <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500 border border-blue-500/20">
                  <Globe className="size-2.5" />
                  <span className="ws-meta text-[8px] tracking-tighter">Public</span>
                </div>
              )}
              {!instance.is_enabled && (
                <Badge variant="outline" className="h-4 px-1 text-[9px] border-[var(--warn-border)] text-[var(--warn)] bg-[var(--warn-soft)] uppercase font-bold">Paused</Badge>
              )}
            </div>
            
            <div className="flex items-center gap-4 mt-1.5">
               <StatusIndicator status={instance.status} latency={instance.latency} />
               
               <div className="flex items-center gap-1.5 opacity-60">
                  <Activity className="size-3 text-[var(--ink-4)]" />
                  <span className="ws-num text-[11px] text-[var(--ink-2)] font-medium">{instance.model_count ?? 0} Models Active</span>
               </div>
               
               <div className="hidden sm:flex items-center gap-1.5 opacity-40">
                  <ShieldCheck className="size-3 text-[var(--ink-4)]" />
                  <span className="ws-num text-[10px] text-[var(--ink-3)] truncate max-w-[200px]">{instance.base_url.replace(/^https?:\/\//, '')}</span>
               </div>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {safeSyncState.is_syncing && (
            <div className="flex items-center gap-3 px-3 py-1.5 rounded-full bg-[var(--accent-soft)] border border-[var(--accent-border)]">
               <RefreshCw className="size-3.5 animate-spin text-[var(--accent-strong)]" />
               <div className="flex flex-col gap-0.5">
                  <span className="ws-num text-[10px] font-bold text-[var(--accent-ink)] leading-none">{safeSyncState.progress}%</span>
                  <div className="w-12 h-1 bg-[var(--accent-strong)]/20 rounded-full overflow-hidden">
                    <div className="h-full bg-[var(--accent-strong)] transition-all duration-300" style={{ width: `${safeSyncState.progress}%` }} />
                  </div>
               </div>
            </div>
          )}
          
          <GlassButton 
            variant="ghost" 
            size="icon" 
            onClick={onSettings} 
            className="size-9 rounded-xl border-[var(--hairline)] hover:bg-[var(--panel-bg-inset)] hover:border-[var(--hairline-strong)]"
          >
            <Settings className="size-4 text-[var(--ink-3)]" />
          </GlassButton>
        </div>
      </div>
    </div>
  );
}
