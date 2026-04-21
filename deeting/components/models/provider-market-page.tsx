"use client";

import * as React from "react";
import { Store, Zap, Search, Cloud, Monitor, User, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/shadcn/badge";
import { Input } from "@/components/ui/shadcn/input";
import { Skeleton } from "@/components/ui/shadcn/skeleton";
import { useProviderHub } from "@/hooks/use-providers";
import { cn } from "@/lib/utils";
import type { ProviderCard } from "@/lib/api/providers";

function categoryLabel(category: string | null | undefined) {
  if (!category) return "unknown";
  return category;
}

function ProviderMarketGrid({ providers }: { providers: ProviderCard[] }) {
  const t = useTranslations("providers.market");

  if (!providers.length) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--panel-bg-inset)] text-[var(--ink-3)]">
          <Store className="size-6" />
        </div>
        <h3 className="ws-pane-title mb-1">{t("grid.emptyTitle")}</h3>
        <p className="ws-caption max-w-[280px]">{t("grid.emptyNoCategory")}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
      {providers.map((provider) => (
        <div key={provider.slug} className="ws-bezel group transition-all duration-300">
          <div className="ws-bezel-inner h-full p-4 flex flex-col">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div 
                  className="flex h-10 w-10 flex-none items-center justify-center rounded-xl border border-[var(--hairline)]"
                  style={{ backgroundColor: provider.theme_color ? `${provider.theme_color}15` : 'var(--panel-bg-inset)' }}
                >
                   {provider.icon ? (
                      <img src={provider.icon} alt="" className="size-6 object-contain" />
                   ) : (
                      <Store className="size-5 text-[var(--ink-3)]" />
                   )}
                </div>
                <div className="min-w-0">
                  <h4 className="ws-pane-title truncate">{provider.name}</h4>
                  <p className="ws-caption truncate">{provider.provider}</p>
                </div>
              </div>
              <Badge 
                variant={provider.connected ? "default" : "outline"}
                className={cn(
                   "ws-meta h-5 px-2",
                   provider.connected ? "bg-[var(--accent-strong)]" : "border-[var(--hairline)] text-[var(--ink-3)]"
                )}
              >
                {provider.connected ? t("card.connected") : categoryLabel(provider.category)}
              </Badge>
            </div>

            <div className="flex-1 space-y-3">
              <p className="ws-body line-clamp-2 text-xs leading-relaxed">
                {provider.description || t("card.noDescription")}
              </p>
              
              <div className="flex flex-wrap gap-1.5">
                {(provider.capabilities || []).slice(0, 3).map((capability) => (
                  <Badge 
                    key={capability} 
                    variant="outline" 
                    className="h-5 px-1.5 py-0 text-[10px] font-medium uppercase tracking-wider text-[var(--ink-3)] border-[var(--hairline)]"
                  >
                    {capability}
                  </Badge>
                ))}
                {(provider.capabilities?.length || 0) > 3 && (
                   <span className="text-[10px] text-[var(--ink-4)] flex items-center">
                      +{provider.capabilities!.length - 3}
                   </span>
                )}
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-[var(--hairline-subtle)] pt-3">
               <div className="flex items-center gap-1.5">
                  <div className={cn("ws-dot", provider.connected && "bg-[var(--ok)]")} />
                  <span className="ws-caption">{provider.connected ? "Online" : "Ready"}</span>
               </div>
               <button className="ws-control text-[var(--accent-ink)] hover:underline">
                  {provider.connected ? t("card.actionManage") : t("card.actionConnect")}
               </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function ProviderMarketPage() {
  const t = useTranslations("providers.market");
  const [selectedTab, setSelectedTab] = React.useState<"all" | "cloud" | "local" | "custom" | "platform">("all");
  const [query, setQuery] = React.useState("");

  const params = React.useMemo(() => {
    const p: any = { q: query || undefined, include_public: true };
    if (selectedTab === "cloud") p.category = "cloud api";
    if (selectedTab === "local") p.category = "local hosted";
    if (selectedTab === "custom") p.category = "custom";
    if (selectedTab === "platform") p.category = "platform";
    return p;
  }, [query, selectedTab]);

  const { providers, stats, isLoading } = useProviderHub(params);

  const categories = [
    { id: "all", label: t("tabs.all"), icon: Store },
    { id: "platform", label: t("tabs.platform"), icon: ShieldCheck },
    { id: "cloud", label: t("tabs.cloud"), icon: Cloud },
    { id: "local", label: t("tabs.local"), icon: Monitor },
    { id: "custom", label: t("tabs.custom"), icon: User },
  ];

  return (
    <div className="flex flex-col bg-[var(--window-bg)] overflow-hidden -mx-[var(--shell-canvas-px)] -mt-[var(--shell-canvas-pt)] -mb-[var(--shell-canvas-pb)] h-[calc(100vh-var(--shell-toolbar-h))]">
        {/* Workspace Toolbar */}
      <div className="flex h-[48px] flex-none items-center justify-between border-b border-[var(--hairline)] bg-[var(--panel-bg-inset)]/30 px-4">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
             <Store className="size-4 text-[var(--accent-strong)]" />
             <h1 className="ws-view-title">{t("title")}</h1>
          </div>
          <div className="h-4 w-px bg-[var(--hairline)]" />
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--ink-3)]" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="h-7 border-none bg-[var(--panel-bg-inset)] pl-8 text-xs focus-visible:ring-1 focus-visible:ring-[var(--hairline-strong)]"
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          {stats && (
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--panel-bg-inset)] border border-[var(--hairline)]">
              <Zap className="size-3 text-amber-500" />
              <span className="ws-num text-[11px] font-medium">
                {stats.connected} / {stats.total}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Secondary Sidebar (Categories) */}
        <aside className="w-56 flex-none border-r border-[var(--hairline)] bg-[var(--panel-bg-inset)]/20 p-3 overflow-y-auto custom-scrollbar">
          <nav className="space-y-1">
            <p className="ws-meta px-2 py-2 mb-1">Categories</p>
            {categories.map((cat) => {
              const active = selectedTab === cat.id;
              const Icon = cat.icon;
              return (
                <button
                  key={cat.id}
                  onClick={() => setSelectedTab(cat.id as any)}
                  className={cn(
                    "ws-rail flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors",
                    active ? "ws-row-active" : "text-[var(--ink-2)] hover:bg-[var(--hairline-subtle)]"
                  )}
                  data-active={active}
                >
                  <Icon className={cn("size-4", active ? "text-[var(--accent-strong)]" : "text-[var(--ink-3)]")} />
                  <span className="ws-control">{cat.label}</span>
                </button>
              );
            })}
          </nav>
          
          <div className="mt-8 px-2">
             <div className="rounded-xl border border-dashed border-[var(--hairline-strong)] p-4 text-center">
                <p className="ws-caption mb-3">{t("grid.requestProvider")}</p>
                <button className="ws-control text-xs text-[var(--accent-ink)] hover:underline">
                   Request
                </button>
             </div>
          </div>
        </aside>

        {/* Content Area */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar bg-[var(--panel-bg)]">
          <div className="p-6">
            {isLoading ? (
              <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <Skeleton key={i} className="h-48 rounded-[18px]" />
                ))}
              </div>
            ) : (
              <ProviderMarketGrid providers={providers} />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
