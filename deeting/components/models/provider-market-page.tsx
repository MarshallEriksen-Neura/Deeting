"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import {
  CheckCircle2,
  ChevronRight,
  Cloud,
  Copy,
  FileJson,
  FolderOpen,
  Monitor,
  RefreshCw,
  Search,
  ServerCog,
  ShieldCheck,
  Store,
  User,
  Zap,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/shadcn/badge";
import { Input } from "@/components/ui/shadcn/input";
import { Skeleton } from "@/components/ui/shadcn/skeleton";
import { ProviderIcon } from "@/components/models/provider-icon";
import { useProviderHub } from "@/hooks/use-providers";
import { usePlatform } from "@/lib/platform/provider";
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
    brand_color: provider.theme_color || "#0a84ff",
    icon_key: provider.icon || "lucide:server",
  };
}

function compactEndpoint(value?: string | null) {
  if (!value) return "-";

  try {
    const url = new URL(value);
    return `${url.host}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return value.replace(/^https?:\/\//, "");
  }
}

function averageLatency(provider: ProviderCard) {
  const values = (provider.instances || [])
    .map((instance) => Number(instance.latency_ms))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (!values.length) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function enabledInstanceCount(provider: ProviderCard) {
  return (provider.instances || []).filter((instance) => instance.is_enabled).length;
}

function ProviderGlyph({ provider, className }: { provider: ProviderCard; className?: string }) {
  return (
    <div
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-[10px] border border-[var(--hairline)] bg-[var(--panel-bg)] shadow-[var(--elev-inset-hi)]",
        className
      )}
    >
      <ProviderIcon
        src={provider.icon}
        className="size-5"
        fallback={<Store className="size-4 text-[var(--ink-4)]" />}
      />
    </div>
  );
}

function CategoryRail({
  categories,
  selectedTab,
  onSelect,
}: {
  categories: Array<{ id: MarketTab; label: string; icon: React.ComponentType<{ className?: string }>; count?: number }>;
  selectedTab: MarketTab;
  onSelect: (tab: MarketTab) => void;
}) {
  const t = useTranslations("providers.market");

  return (
    <aside className="w-56 flex-none border-r border-[var(--hairline)] bg-[var(--panel-bg-inset)]/42 px-3 py-4">
      <p className="ws-meta mb-2 px-2 text-[9px] text-[var(--ink-4)]">{t("workstation.navigator")}</p>
      <nav className="space-y-1">
        {categories.map((category) => {
          const active = selectedTab === category.id;
          const Icon = category.icon;
          return (
            <button
              key={category.id}
              type="button"
              onClick={() => onSelect(category.id)}
              className={cn(
                "flex h-8 w-full items-center gap-2 rounded-[9px] px-2.5 text-left text-[13px] transition-colors",
                active
                  ? "bg-[var(--panel-bg)] text-[var(--ink)] shadow-[0_1px_0_var(--hairline),0_8px_22px_-18px_rgba(15,23,42,0.42)]"
                  : "text-[var(--ink-2)] hover:bg-[var(--panel-bg)]/70 hover:text-[var(--ink)]"
              )}
            >
              <Icon className={cn("size-4", active ? "text-[var(--accent-strong)]" : "text-[var(--ink-4)]")} />
              <span className="min-w-0 flex-1 truncate font-medium">{category.label}</span>
              {typeof category.count === "number" && (
                <span className="font-mono text-[10px] tabular-nums text-[var(--ink-4)]">{category.count}</span>
              )}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

function ProviderResourceRow({
  provider,
  selected,
  onSelect,
  onConfigure,
}: {
  provider: ProviderCard;
  selected: boolean;
  onSelect: (provider: ProviderCard) => void;
  onConfigure: (provider: ProviderCard) => void;
}) {
  const t = useTranslations("providers.market");
  const latency = averageLatency(provider);
  const enabledCount = enabledInstanceCount(provider);
  const instanceCount = provider.instances?.length || 0;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(provider)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(provider);
        }
      }}
      className={cn(
        "group grid min-h-[68px] w-full grid-cols-[minmax(260px,1fr)_minmax(220px,0.7fr)_auto] items-center gap-4 border-b border-[var(--hairline-subtle)] px-4 text-left transition-colors",
        selected ? "bg-[color-mix(in_srgb,var(--accent-soft)_58%,white_42%)]" : "hover:bg-[var(--panel-bg-inset)]/58"
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <ProviderGlyph provider={provider} />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-[14px] font-semibold tracking-tight text-[var(--ink)]">{provider.name}</h3>
            {provider.connected && <CheckCircle2 className="size-3.5 shrink-0 text-[var(--ok)]" />}
          </div>
          <p className="mt-0.5 line-clamp-1 text-[12px] leading-4 text-[var(--ink-3)]">
            {provider.description || t("card.noDescription")}
          </p>
        </div>
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="rounded-[7px] bg-[var(--panel-bg-inset)] px-2 py-1 font-mono text-[10px] uppercase text-[var(--ink-3)] ring-1 ring-[var(--hairline-subtle)]">
          {provider.protocol || provider.provider}
        </span>
        <span className="rounded-[7px] bg-[var(--panel-bg-inset)] px-2 py-1 text-[11px] text-[var(--ink-3)] ring-1 ring-[var(--hairline-subtle)]">
          {t("details.instances")} <span className="font-mono text-[var(--ink-2)]">{enabledCount}/{instanceCount}</span>
        </span>
        <span className="rounded-[7px] bg-[var(--panel-bg-inset)] px-2 py-1 text-[11px] text-[var(--ink-3)] ring-1 ring-[var(--hairline-subtle)]">
          {t("details.latency")} <span className="font-mono text-[var(--ink-2)]">{latency ? `${latency} ms` : "-"}</span>
        </span>
      </div>

      <div className="flex items-center justify-end gap-2">
        <span
          className={cn(
            "inline-flex h-7 items-center rounded-full border px-2 text-[11px] font-medium",
            provider.connected
              ? "border-[var(--ok-border)] bg-[var(--ok-soft)] text-[var(--ok)]"
              : "border-[var(--hairline)] bg-[var(--panel-bg)] text-[var(--ink-3)]"
          )}
        >
          {provider.connected ? t("details.connected") : t("details.notConnected")}
        </span>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onConfigure(provider);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              event.stopPropagation();
              onConfigure(provider);
            }
          }}
          className="inline-flex h-7 items-center gap-1.5 rounded-[8px] border border-[var(--hairline)] bg-[var(--panel-bg)] px-2.5 text-[12px] font-semibold text-[var(--ink)] shadow-[var(--elev-inset-hi)] transition-colors hover:border-[var(--hairline-strong)] hover:bg-[var(--window-bg)]"
        >
          {provider.connected ? t("card.actionManage") : t("card.actionConnect")}
          <ChevronRight className="size-3.5 text-[var(--ink-4)]" />
        </button>
      </div>
    </div>
  );
}

function ProviderList({
  providers,
  selectedSlug,
  isLoading,
  query,
  onSelect,
  onConfigure,
}: {
  providers: ProviderCard[];
  selectedSlug?: string;
  isLoading: boolean;
  query: string;
  onSelect: (provider: ProviderCard) => void;
  onConfigure: (provider: ProviderCard) => void;
}) {
  const t = useTranslations("providers.market");

  if (isLoading) {
    return (
      <div className="space-y-0 rounded-[12px] border border-[var(--hairline)] bg-[var(--panel-bg)]">
        {[1, 2, 3, 4, 5, 6].map((item) => (
          <div key={item} className="grid min-h-[68px] grid-cols-[minmax(260px,1fr)_minmax(220px,0.7fr)_112px] gap-4 border-b border-[var(--hairline-subtle)] px-4 py-3 last:border-b-0">
            <div className="flex items-center gap-3">
              <Skeleton className="size-9 rounded-[10px] bg-[var(--panel-bg-inset)]" />
              <div className="space-y-2">
                <Skeleton className="h-3 w-32 bg-[var(--panel-bg-inset)]" />
                <Skeleton className="h-3 w-52 bg-[var(--panel-bg-inset)]" />
              </div>
            </div>
            <Skeleton className="my-auto h-6 w-52 rounded-[7px] bg-[var(--panel-bg-inset)]" />
            <Skeleton className="my-auto h-8 w-24 rounded-[9px] bg-[var(--panel-bg-inset)]" />
          </div>
        ))}
      </div>
    );
  }

  if (!providers.length) {
    return (
      <div className="flex min-h-[420px] flex-col items-center justify-center rounded-[14px] border border-[var(--hairline)] bg-[var(--panel-bg)] px-8 text-center shadow-[var(--elev-inset-hi)]">
        <div className="mb-4 flex size-11 items-center justify-center rounded-[12px] border border-[var(--hairline)] bg-[var(--panel-bg-inset)] text-[var(--ink-4)]">
          <Store className="size-5" />
        </div>
        <h3 className="text-[15px] font-semibold text-[var(--ink)]">{t("grid.emptyTitle")}</h3>
        <p className="mt-2 max-w-[360px] text-[13px] leading-6 text-[var(--ink-3)]">
          {query ? t("grid.emptyNoMatch", { query }) : t("grid.emptyNoCategory")}
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[12px] border border-[var(--hairline)] bg-[var(--panel-bg)] shadow-[var(--elev-inset-hi)]">
      {providers.map((provider) => (
        <ProviderResourceRow
          key={provider.slug}
          provider={provider}
          selected={provider.slug === selectedSlug}
          onSelect={onSelect}
          onConfigure={onConfigure}
        />
      ))}
    </div>
  );
}

function DetailField({ label, value, compact = false }: { label: string; value: React.ReactNode; compact?: boolean }) {
  return (
    <div className={cn("rounded-[10px] border border-[var(--hairline-subtle)] bg-[var(--panel-bg-inset)]/44 px-3", compact ? "py-2" : "py-2.5")}>
      <p className="ws-meta text-[9px] text-[var(--ink-4)]">{label}</p>
      <div className="mt-1 min-w-0 text-[12px] leading-5 text-[var(--ink-2)]">{value}</div>
    </div>
  );
}

function ProviderInspector({
  provider,
  onConfigure,
}: {
  provider?: ProviderCard;
  onConfigure: (provider: ProviderCard) => void;
}) {
  const t = useTranslations("providers.market");

  if (!provider) {
    return (
      <aside className="w-[336px] flex-none border-l border-[var(--hairline)] bg-[var(--panel-bg)] p-5">
        <div className="flex h-full flex-col items-center justify-center text-center">
          <div className="mb-4 flex size-12 items-center justify-center rounded-[14px] border border-[var(--hairline)] bg-[var(--panel-bg-inset)] text-[var(--ink-4)]">
            <ServerCog className="size-5" />
          </div>
          <h3 className="text-[14px] font-semibold text-[var(--ink)]">{t("details.noSelectionTitle")}</h3>
          <p className="mt-2 text-[12px] leading-5 text-[var(--ink-3)]">{t("details.noSelectionDescription")}</p>
        </div>
      </aside>
    );
  }

  const latency = averageLatency(provider);
  const instances = provider.instances || [];
  const enabledCount = enabledInstanceCount(provider);

  return (
    <aside className="w-[320px] flex-none overflow-y-auto border-l border-[var(--hairline)] bg-[var(--panel-bg)] custom-scrollbar">
      <div className="border-b border-[var(--hairline)] p-4">
        <div className="flex items-start gap-3">
          <ProviderGlyph provider={provider} className="size-11 rounded-[12px]" />
          <div className="min-w-0 flex-1">
            <p className="ws-meta text-[9px] text-[var(--ink-4)]">{provider.provider}</p>
            <h2 className="mt-1 truncate text-[17px] font-semibold tracking-tight text-[var(--ink)]">{provider.name}</h2>
          </div>
        </div>

        <p className="mt-3 line-clamp-2 text-[12px] leading-5 text-[var(--ink-3)]">
          {provider.description || t("card.noDescription")}
        </p>

        <button
          type="button"
          onClick={() => onConfigure(provider)}
          className="mt-4 flex h-9 w-full items-center justify-center gap-2 rounded-[10px] bg-[var(--accent-strong)] px-3 text-[13px] font-semibold text-[var(--accent-contrast)] shadow-[0_10px_24px_-18px_var(--accent-strong)] transition-transform active:translate-y-px"
        >
          {provider.connected ? t("card.actionManage") : t("card.actionConnect")}
          <ChevronRight className="size-4" />
        </button>
      </div>

      <div className="space-y-3 p-4">
        <div className="grid grid-cols-2 gap-2">
          <DetailField
            label={t("details.status")}
            compact
            value={
              <span className={cn("font-medium", provider.connected ? "text-[var(--ok)]" : "text-[var(--ink-3)]")}>
                {provider.connected ? t("details.connected") : t("details.notConnected")}
              </span>
            }
          />
          <DetailField compact label={t("details.latency")} value={<span className="font-mono">{latency ? `${latency} ms` : "-"}</span>} />
          <DetailField compact label={t("details.instances")} value={<span className="font-mono">{enabledCount}/{instances.length}</span>} />
          <DetailField compact label={t("details.category")} value={<span className="truncate">{provider.category || "-"}</span>} />
        </div>

        <DetailField
          label={t("details.endpoint")}
          compact
          value={<span className="block truncate font-mono text-[11px]">{compactEndpoint(provider.base_url || provider.url_template)}</span>}
        />

        <DetailField
          label={t("details.protocol")}
          compact
          value={<span className="font-mono text-[11px] uppercase">{provider.protocol || provider.provider}</span>}
        />

        <section className="rounded-[12px] border border-[var(--hairline-subtle)] bg-[var(--panel-bg-inset)]/28 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="ws-meta text-[9px] text-[var(--ink-4)]">{t("details.capabilities")}</p>
            <span className="font-mono text-[10px] text-[var(--ink-4)]">{provider.capabilities?.length || 0}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(provider.capabilities || []).slice(0, 8).map((capability) => (
              <Badge
                key={capability}
                variant="outline"
                className="rounded-[7px] border-[var(--hairline)] bg-[var(--panel-bg-inset)] px-2 py-0.5 font-mono text-[9px] uppercase text-[var(--ink-3)]"
              >
                {capability}
              </Badge>
            ))}
            {!provider.capabilities?.length && <span className="text-[12px] text-[var(--ink-4)]">-</span>}
          </div>
        </section>

        <section className="rounded-[12px] border border-[var(--hairline-subtle)] bg-[var(--panel-bg-inset)]/28 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="ws-meta text-[9px] text-[var(--ink-4)]">{t("details.instanceHealth")}</p>
            <span className="font-mono text-[10px] text-[var(--ink-4)]">{instances.length}</span>
          </div>
          <div className="overflow-hidden rounded-[10px] border border-[var(--hairline)] bg-[var(--panel-bg)]">
            {instances.length ? (
              instances.slice(0, 5).map((instance) => (
                <div key={instance.id} className="flex items-center justify-between gap-3 border-b border-[var(--hairline-subtle)] px-3 py-2 last:border-b-0">
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-medium text-[var(--ink)]">{instance.name}</p>
                    <p className="mt-0.5 font-mono text-[10px] text-[var(--ink-4)]">{instance.health_status || "unknown"}</p>
                  </div>
                  <span className="font-mono text-[10px] text-[var(--ink-3)]">{instance.latency_ms ? `${instance.latency_ms} ms` : "-"}</span>
                </div>
              ))
            ) : (
              <div className="px-3 py-5 text-center text-[12px] text-[var(--ink-4)]">{t("details.noInstances")}</div>
            )}
          </div>
        </section>
      </div>
    </aside>
  );
}

export function ProviderMarketPage() {
  const t = useTranslations("providers.market");
  const { provider } = usePlatform();
  const [selectedTab, setSelectedTab] = React.useState<MarketTab>("all");
  const [query, setQuery] = React.useState("");
  const [selectedSlug, setSelectedSlug] = React.useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [selectedPreset, setSelectedPreset] = React.useState<ProviderPresetConfig | null>(null);
  const [marketFilePath, setMarketFilePath] = React.useState<string | null>(null);
  const [copiedPath, setCopiedPath] = React.useState(false);

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

  React.useEffect(() => {
    let cancelled = false;
    provider
      .getProviderMarketFilePath?.()
      .then((path) => {
        if (!cancelled) setMarketFilePath(path);
      })
      .catch(() => {
        if (!cancelled) setMarketFilePath(null);
      });
    return () => {
      cancelled = true;
    };
  }, [provider]);

  React.useEffect(() => {
    if (!providers.length) {
      setSelectedSlug(null);
      return;
    }

    if (!selectedSlug || !providers.some((provider) => provider.slug === selectedSlug)) {
      setSelectedSlug(providers[0].slug);
    }
  }, [providers, selectedSlug]);

  const selectedProvider = React.useMemo(
    () => providers.find((provider) => provider.slug === selectedSlug) || providers[0],
    [providers, selectedSlug]
  );

  const handleProviderSelect = React.useCallback((provider: ProviderCard) => {
    setSelectedSlug(provider.slug);
  }, []);

  const handleProviderConfigure = React.useCallback((provider: ProviderCard) => {
    setSelectedSlug(provider.slug);
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

  const handleCopyMarketPath = React.useCallback(async () => {
    if (!marketFilePath) return;
    await navigator.clipboard?.writeText(marketFilePath);
    setCopiedPath(true);
    window.setTimeout(() => setCopiedPath(false), 1600);
  }, [marketFilePath]);

  const handleOpenMarketFile = React.useCallback(async () => {
    if (!marketFilePath) return;
    const { openPath } = await import("@tauri-apps/plugin-opener");
    await openPath(marketFilePath);
  }, [marketFilePath]);

  const handleRevealMarketFile = React.useCallback(async () => {
    if (!marketFilePath) return;
    const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
    await revealItemInDir(marketFilePath);
  }, [marketFilePath]);

  const handleReloadMarketFile = React.useCallback(async () => {
    await mutate();
  }, [mutate]);

  const categories: Array<{ id: MarketTab; label: string; icon: React.ComponentType<{ className?: string }>; count?: number }> = [
    { id: "all", label: t("tabs.all"), icon: Store, count: stats?.total },
    { id: "platform", label: t("tabs.platform"), icon: ShieldCheck, count: stats?.by_category?.platform },
    { id: "cloud", label: t("tabs.cloud"), icon: Cloud, count: stats?.by_category?.["cloud api"] },
    { id: "local", label: t("tabs.local"), icon: Monitor, count: stats?.by_category?.["local hosted"] },
    { id: "custom", label: t("tabs.custom"), icon: User, count: stats?.by_category?.custom },
  ];

  return (
    <div className="relative -mx-[var(--shell-canvas-px)] -mb-[var(--shell-canvas-pb)] -mt-[var(--shell-canvas-pt)] flex h-[calc(100%+var(--shell-canvas-pt)+var(--shell-canvas-pb))] min-h-0 flex-col overflow-hidden bg-[var(--window-bg)]">
      <header className="flex h-14 flex-none items-center justify-between border-b border-[var(--hairline)] bg-[var(--panel-bg)]/86 px-5 backdrop-blur-xl">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex size-9 items-center justify-center rounded-[11px] border border-[var(--hairline)] bg-[var(--panel-bg-inset)] text-[var(--accent-strong)] shadow-[var(--elev-inset-hi)]">
            <ServerCog className="size-4" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-[18px] font-semibold tracking-tight text-[var(--ink)]">{t("title")}</h1>
            <p className="mt-0.5 truncate text-[12px] text-[var(--ink-3)]">{t("description")}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {marketFilePath && (
            <div className="flex h-9 max-w-[420px] items-center gap-1 rounded-[11px] border border-[var(--hairline)] bg-[var(--panel-bg-inset)] px-2 text-[12px] text-[var(--ink-2)] shadow-[var(--elev-inset-hi)]">
              <button
                type="button"
                title={marketFilePath}
                onClick={handleOpenMarketFile}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-[8px] px-1.5 py-1.5 transition-colors hover:bg-[var(--panel-bg)]"
              >
                <FileJson className="size-3.5 shrink-0 text-[var(--accent-strong)]" />
                <span className="shrink-0 font-medium">{t("localFile.label")}</span>
                <span className="min-w-0 truncate font-mono text-[11px] text-[var(--ink-3)]">
                  {marketFilePath}
                </span>
              </button>
              <button
                type="button"
                title={t("localFile.copy")}
                onClick={handleCopyMarketPath}
                className="flex size-7 shrink-0 items-center justify-center rounded-[8px] transition-colors hover:bg-[var(--panel-bg)]"
              >
                {copiedPath ? (
                  <CheckCircle2 className="size-3.5 text-[var(--ok)]" />
                ) : (
                  <Copy className="size-3.5 text-[var(--ink-4)]" />
                )}
              </button>
              <button
                type="button"
                title={t("localFile.reveal")}
                onClick={handleRevealMarketFile}
                className="flex size-7 shrink-0 items-center justify-center rounded-[8px] transition-colors hover:bg-[var(--panel-bg)]"
              >
                <FolderOpen className="size-3.5 text-[var(--ink-4)]" />
              </button>
              <button
                type="button"
                title={t("localFile.reload")}
                onClick={handleReloadMarketFile}
                className="flex size-7 shrink-0 items-center justify-center rounded-[8px] transition-colors hover:bg-[var(--panel-bg)]"
              >
                <RefreshCw className="size-3.5 text-[var(--ink-4)]" />
              </button>
            </div>
          )}
          <div className="relative w-[320px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--ink-4)]" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("searchPlaceholder")}
              className="h-9 rounded-[11px] border-[var(--hairline)] bg-[var(--panel-bg-inset)]/72 pl-9 text-[13px] shadow-none focus-visible:ring-1 focus-visible:ring-[var(--accent-border)]"
            />
          </div>
          {stats && (
            <div className="flex h-9 items-center gap-2 rounded-[11px] border border-[var(--hairline)] bg-[var(--panel-bg-inset)] px-3 text-[12px] text-[var(--ink-2)] shadow-[var(--elev-inset-hi)]">
              <Zap className="size-3.5 text-[var(--accent-strong)]" />
              <span className="font-mono tabular-nums">
                {stats.connected}<span className="mx-1 text-[var(--ink-4)]">/</span>{stats.total}
              </span>
            </div>
          )}
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[auto_minmax(640px,1fr)_320px] overflow-hidden">
        <CategoryRail categories={categories} selectedTab={selectedTab} onSelect={setSelectedTab} />

        <main className="min-w-0 overflow-y-auto bg-[var(--window-bg)] px-5 py-4 custom-scrollbar">
          <div className="mb-3 flex h-9 items-center justify-between rounded-[12px] border border-[var(--hairline)] bg-[var(--panel-bg)] px-3 shadow-[var(--elev-inset-hi)]">
            <div className="flex items-center gap-2 text-[12px] text-[var(--ink-3)]">
              <Store className="size-3.5 text-[var(--ink-4)]" />
              <span>{t("details.providers")}</span>
              <span className="font-mono text-[var(--ink)]">{stats?.total ?? providers.length}</span>
            </div>
            <div className="flex items-center gap-4 text-[12px] text-[var(--ink-3)]">
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="size-3.5 text-[var(--ok)]" />
                {t("details.connected")}
                <span className="font-mono text-[var(--ink)]">{stats?.connected ?? providers.filter((provider) => provider.connected).length}</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                {t("details.visible")}
                <span className="font-mono text-[var(--ink)]">{providers.length}</span>
              </span>
            </div>
          </div>

          <ProviderList
            providers={providers}
            selectedSlug={selectedProvider?.slug}
            isLoading={isLoading}
            query={query}
            onSelect={handleProviderSelect}
            onConfigure={handleProviderConfigure}
          />
        </main>

        <ProviderInspector provider={selectedProvider} onConfigure={handleProviderConfigure} />
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
