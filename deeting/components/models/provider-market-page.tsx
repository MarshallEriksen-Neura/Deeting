"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { Store, Zap, Search, Cloud, Monitor, User, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/shadcn/badge";
import { Input } from "@/components/ui/shadcn/input";
import { Skeleton } from "@/components/ui/shadcn/skeleton";
import { useProviderHub } from "@/hooks/use-providers";
import { cn } from "@/lib/utils";
import type { ProviderCard } from "@/lib/api/providers";
import type { ProviderPresetConfig } from "@/components/providers/connect-provider-drawer";

const ConnectProviderDrawer = dynamic(
  () => import("@/components/providers/connect-provider-drawer"),
  { ssr: false }
);

type MarketTab = "all" | "cloud" | "local" | "custom" | "platform";

function mapProviderToPreset(provider: ProviderCard): ProviderPresetConfig {
  return {
    slug: provider.slug,
    name: provider.name,
    type: provider.slug === "custom" ? "custom" : "system",
    provider: provider.provider,
    protocol: provider.protocol ?? undefined,
    default_endpoint: provider.base_url || undefined,
    brand_color: provider.theme_color || "#3b82f6",
    icon_key: provider.icon || "lucide:server",
  };
}

function ProviderCard({ 
  provider, 
  onSelect 
}: { 
  provider: ProviderCard; 
  onSelect: (p: ProviderCard) => void 
}) {
  const t = useTranslations("providers.market");
  
  // 动态生成品牌氛围色
  const brandColor = provider.theme_color || "#6d5cff";
  const glowStyle = {
    "--brand-glow": `${brandColor}15`,
    "--brand-border": `${brandColor}30`,
  } as React.CSSProperties;

  return (
    <div 
      onClick={() => onSelect(provider)}
      style={glowStyle}
      className="group relative cursor-pointer"
    >
      {/* 3D 悬浮层 - 背景 */}
      <div className="absolute inset-0 rounded-[32px] bg-[var(--panel-bg-inset)] opacity-50 transition-all duration-500 group-hover:scale-[1.02] group-hover:opacity-100 group-hover:shadow-[0_40px_80px_-20px_rgba(0,0,0,0.5)]" />
      
      {/* 品牌氛围光晕 */}
      <div className="absolute -inset-2 rounded-[40px] bg-[radial-gradient(circle_at_center,var(--brand-glow),transparent_70%)] opacity-0 blur-2xl transition-opacity duration-700 group-hover:opacity-100" />

      {/* 核心容器 */}
      <div className="relative flex h-full flex-col overflow-hidden rounded-[32px] border border-white/[0.03] bg-gradient-to-b from-white/[0.02] to-transparent p-6 transition-all duration-500 group-hover:border-[var(--brand-border)] group-hover:translate-y-[-4px]">
        
        {/* 顶部区域：Icon & Meta */}
        <div className="mb-8 flex items-start justify-between">
          <div className="relative">
            <div className="flex size-14 items-center justify-center rounded-2xl border border-white/[0.05] bg-[var(--window-bg)] shadow-inner transition-transform duration-700 group-hover:rotate-[10deg] group-hover:scale-110">
              {provider.icon ? (
                <img src={provider.icon} alt="" className="size-8 object-contain" />
              ) : (
                <Store className="size-7 text-[var(--ink-4)]" />
              )}
            </div>
            {/* Icon 背后的小装饰点 */}
            <div className="absolute -right-1 -top-1 size-2 rounded-full bg-[var(--brand-glow)] blur-[2px] animate-pulse" />
          </div>

          <div className="flex flex-col items-end gap-2">
            <Badge className="ws-meta border-white/[0.05] bg-white/[0.03] px-2 py-0.5 text-[9px] tracking-[0.2em] text-[var(--ink-4)] group-hover:text-[var(--ink-2)]">
              {provider.provider.toUpperCase()}
            </Badge>
            {provider.connected && (
              <div className="flex items-center gap-1.5 rounded-full bg-[var(--ok-soft)] px-2 py-0.5 border border-[var(--ok-border)]">
                <div className="size-1 rounded-full bg-[var(--ok)] shadow-[0_0_8px_var(--ok)]" />
                <span className="text-[9px] font-black text-[var(--ok)] uppercase tracking-tighter">{t("card.connected")}</span>
              </div>
            )}
          </div>
        </div>

        {/* 标题 & 描述 */}
        <div className="mb-6">
          <h4 className="ws-view-title mb-2 text-xl tracking-tight transition-colors group-hover:text-white">{provider.name}</h4>
          <p className="ws-body line-clamp-2 text-xs leading-relaxed text-[var(--ink-3)] group-hover:text-[var(--ink-2)]">
            {provider.description || t("card.noDescription")}
          </p>
        </div>

        {/* 能力标签：采用极简主义的药丸设计 */}
        <div className="mt-auto flex flex-wrap gap-1.5">
          {(provider.capabilities || []).slice(0, 3).map((capability) => (
            <span 
              key={capability} 
              className="rounded-md border border-white/[0.03] bg-white/[0.02] px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-widest text-[var(--ink-4)] transition-all group-hover:border-[var(--brand-border)] group-hover:text-[var(--ink-2)]"
            >
              {capability}
            </span>
          ))}
          {(provider.capabilities?.length || 0) > 3 && (
            <span className="font-mono text-[9px] text-[var(--ink-4)] opacity-40">
              +{provider.capabilities!.length - 3}
            </span>
          )}
        </div>

        {/* 底部交互条 */}
        <div className="mt-8 flex items-center justify-between border-t border-white/[0.03] pt-4 transition-all group-hover:border-[var(--brand-border)]">
           <div className="flex items-center gap-3">
             <div className="ws-dot opacity-40 group-hover:opacity-100" data-tone={provider.connected ? "ok" : "accent"} />
             <span className="ws-num text-[10px] font-bold tracking-widest text-[var(--ink-4)] group-hover:text-[var(--ink-2)]">
                {provider.connected ? t("workstation.uplinkStable") : t("workstation.standbyReady")}
             </span>
           </div>
           <div className="flex items-center gap-1 text-[11px] font-black tracking-tighter text-[var(--accent-strong)] opacity-0 transition-all duration-500 translate-x-2 group-hover:opacity-100 group-hover:translate-x-0">
              {provider.connected ? t("workstation.manageSystem") : t("workstation.initialize")}
              <Zap className="size-3 fill-current" />
           </div>
        </div>
      </div>
    </div>
  );
}

function ProviderMarketGrid({
  providers,
  onProviderSelect,
}: {
  providers: ProviderCard[];
  onProviderSelect: (provider: ProviderCard) => void;
}) {
  const t = useTranslations("providers.market");

  if (!providers.length) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center">
        <div className="mb-6 flex size-20 items-center justify-center rounded-[32px] bg-[var(--panel-bg-inset)] text-[var(--ink-4)] shadow-inner">
          <Store className="size-10 opacity-20" />
        </div>
        <h3 className="ws-view-title mb-2 text-2xl tracking-tighter">{t("grid.emptyTitle")}</h3>
        <p className="ws-body max-w-[320px] text-sm text-[var(--ink-3)]">{t("grid.emptyNoCategory")}</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-8 md:grid-cols-2 2xl:grid-cols-3">
      {providers.map((provider) => (
        <ProviderCard 
          key={provider.slug} 
          provider={provider} 
          onSelect={onProviderSelect} 
        />
      ))}
    </div>
  );
}

export function ProviderMarketPage() {
  const t = useTranslations("providers.market");
  const [selectedTab, setSelectedTab] = React.useState<MarketTab>("all");
  const [query, setQuery] = React.useState("");
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [selectedPreset, setSelectedPreset] = React.useState<ProviderPresetConfig | null>(null);

  const params = React.useMemo(() => {
    const p: {
      q?: string;
      include_public: true;
      category?: string;
    } = { q: query || undefined, include_public: true };
    if (selectedTab === "cloud") p.category = "cloud api";
    if (selectedTab === "local") p.category = "local hosted";
    if (selectedTab === "custom") p.category = "custom";
    if (selectedTab === "platform") p.category = "platform";
    return p;
  }, [query, selectedTab]);

  const { providers, stats, isLoading, mutate } = useProviderHub(params);

  const handleProviderSelect = React.useCallback((provider: ProviderCard) => {
    setSelectedPreset(mapProviderToPreset(provider));
    setDrawerOpen(true);
  }, []);

  const handleDrawerClose = React.useCallback(() => {
    setDrawerOpen(false);
  }, []);

  const handleDrawerSave = React.useCallback(async () => {
    setDrawerOpen(false);
    await mutate();
  }, [mutate]);

  const categories: Array<{ id: MarketTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: "all", label: t("tabs.all"), icon: Store },
    { id: "platform", label: t("tabs.platform"), icon: ShieldCheck },
    { id: "cloud", label: t("tabs.cloud"), icon: Cloud },
    { id: "local", label: t("tabs.local"), icon: Monitor },
    { id: "custom", label: t("tabs.custom"), icon: User },
  ];

  return (
    <div className="flex flex-col bg-[var(--window-bg)] overflow-hidden -mx-[var(--shell-canvas-px)] -mt-[var(--shell-canvas-pt)] -mb-[var(--shell-canvas-pb)] h-[calc(100vh-var(--shell-toolbar-h))] relative">
      {/* Workspace Toolbar */}
      <div className="flex h-[52px] flex-none items-center justify-between border-b border-[var(--hairline)] bg-[var(--panel-bg-inset)]/40 px-6 backdrop-blur-md relative z-20">
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-2.5">
             <div className="flex size-7 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent-strong)] shadow-sm shadow-[var(--accent-soft)]">
                <Store className="size-4" />
             </div>
             <h1 className="ws-view-title tracking-tight">{t("title")}</h1>
          </div>
          <div className="h-4 w-px bg-[var(--hairline-strong)]" />
          <div className="relative w-72 group">
            <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[var(--ink-4)] transition-colors group-focus-within:text-[var(--accent-strong)]" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="h-8 border-[var(--hairline)] bg-[var(--window-bg)]/50 pl-9 text-xs transition-all focus-visible:ring-1 focus-visible:ring-[var(--accent-border)] focus-visible:bg-[var(--window-bg)]"
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          {stats && (
            <div className="flex items-center gap-2.5 px-3.5 py-1.5 rounded-full bg-[var(--panel-bg)] border border-[var(--hairline-strong)] shadow-sm">
              <Zap className="size-3 text-amber-500 fill-amber-500/20" />
              <span className="ws-num text-[11px] font-bold tracking-tight">
                {stats.connected} <span className="mx-0.5 opacity-30">/</span> {stats.total}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden relative z-10">
        {/* Secondary Sidebar (Categories) */}
        <aside className="w-60 flex-none border-r border-[var(--hairline)] bg-[var(--sidebar-bg)]/40 p-4 overflow-y-auto custom-scrollbar backdrop-blur-sm">
          <nav className="space-y-1.5">
            <p className="ws-meta px-3 py-2 mb-2 text-[9px] opacity-40">{t("workstation.navigator")}</p>
            {categories.map((cat) => {
              const active = selectedTab === cat.id;
              const Icon = cat.icon;
              return (
                <button
                  key={cat.id}
                  onClick={() => setSelectedTab(cat.id)}
                  className={cn(
                    "ws-rail group flex w-full items-center gap-3.5 rounded-xl px-4 py-2.5 text-left transition-all duration-300",
                    active 
                      ? "ws-row-active bg-[var(--accent-soft)]/60 text-[var(--accent-ink)] shadow-[0_8px_20px_-12px_var(--accent-soft)]" 
                      : "text-[var(--ink-2)] hover:bg-[var(--panel-bg-inset)] hover:text-[var(--ink)]"
                  )}
                  data-active={active}
                >
                  <Icon className={cn("size-4 transition-transform duration-300 group-hover:scale-110", active ? "text-[var(--accent-strong)]" : "text-[var(--ink-4)]")} />
                  <span className={cn("ws-control transition-colors", active ? "font-bold" : "font-medium")}>{cat.label}</span>
                  {active && (
                     <div className="ml-auto w-1 h-1 rounded-full bg-[var(--accent-strong)] shadow-[0_0_8px_var(--accent-strong)]" />
                  )}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Content Area */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar bg-[var(--window-bg)] relative">
          {/* Ambient Background Elements */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
             <div className="absolute top-[-10%] left-[-5%] w-[600px] h-[600px] rounded-full bg-[radial-gradient(circle,var(--accent-soft)_0%,transparent_70%)] opacity-[0.15] blur-3xl" />
             <div className="absolute bottom-[-10%] right-[-5%] w-[500px] h-[500px] rounded-full bg-[radial-gradient(circle,var(--accent-soft)_0%,transparent_70%)] opacity-[0.1] blur-3xl" />
             <div 
               className="absolute inset-0 opacity-[0.04]" 
               style={{ 
                 backgroundImage: 'linear-gradient(var(--hairline-strong) 1px, transparent 1px), linear-gradient(90deg, var(--hairline-strong) 1px, transparent 1px)',
                 backgroundSize: '40px 40px',
                 maskImage: 'radial-gradient(circle at center, black, transparent 90%)'
               }} 
             />
          </div>

          <div className="p-8 relative z-10">
            {isLoading ? (
              <div className="grid gap-6 md:grid-cols-2 2xl:grid-cols-3">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <Skeleton key={i} className="h-56 rounded-[24px] bg-[var(--panel-bg-inset)] opacity-50" />
                ))}
              </div>
            ) : (
              <ProviderMarketGrid providers={providers} onProviderSelect={handleProviderSelect} />
            )}
          </div>
        </main>
      </div>

      <ConnectProviderDrawer
        isOpen={drawerOpen}
        onClose={handleDrawerClose}
        preset={selectedPreset}
        onSave={handleDrawerSave}
      />
    </div>
  );
}
