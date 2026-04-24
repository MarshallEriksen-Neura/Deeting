"use client";

import * as React from "react";
import useSWR from "swr";
import { Cpu, Waves, Zap } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/shadcn/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/shadcn/table";
import { fetchLocalModelPoolsStatus, type LocalModelPoolStatus } from "@/lib/api/model-pools";
import { isTauriRuntime } from "@/lib/runtime/tauri";
import { cn } from "@/lib/utils";

const QUERY_KEY = "local-model-pools-status";
const MODEL_POOL_BEZEL_STYLE: React.CSSProperties = {
  background: "color-mix(in srgb, var(--window-bg) 88%, var(--panel-bg-inset) 12%)",
};

function formatPercent(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value * 100)}%` : "--";
}

function formatLatency(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? `${Math.round(value)} ms` : "--";
}

function formatDate(value: string | null | undefined, locale: string) {
  if (!value) return "--";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function PoolNode({ pool, selected, onClick }: { pool: LocalModelPoolStatus; selected: boolean; onClick: () => void }) {
  const t = useTranslations("model-pools");

  return (
    <button
      onClick={onClick}
      className={cn(
        "ws-rail group relative flex w-full flex-col gap-3 rounded-[24px] border p-5 text-left transition-all duration-500",
        selected
          ? "border-[var(--accent-border)] bg-gradient-to-br from-[var(--accent-soft)]/60 to-transparent shadow-[0_30px_60px_-20px_rgba(109,92,255,0.3)]"
          : "border-transparent bg-transparent hover:border-[var(--hairline)] hover:bg-[var(--panel-bg-inset)]/50"
      )}
      type="button"
    >
      {selected ? (
        <div className="absolute bottom-1/4 left-[-16px] top-1/4 w-1 rounded-r-full bg-[var(--accent-strong)] shadow-[6px_0_15px_var(--accent-strong)]" />
      ) : null}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "flex size-10 items-center justify-center rounded-2xl border transition-all duration-700",
              selected ? "border-[var(--accent-border)] bg-[var(--panel-bg)] shadow-md rotate-[-6deg] scale-110" : "border-[var(--hairline)] bg-[var(--panel-bg-inset)] opacity-60"
            )}
          >
            <Cpu className={cn("size-5", selected ? "text-[var(--accent-strong)]" : "text-[var(--ink-4)]")} />
          </div>
          <div>
            <h4 className={cn("ws-control block truncate text-[15px] leading-tight transition-colors", selected ? "font-black tracking-tighter text-[var(--ink)]" : "font-bold text-[var(--ink-2)]")}>{pool.display_name}</h4>
            <span className="mt-1 block font-mono text-[9px] font-black uppercase tracking-[0.2em] text-[var(--ink-4)] opacity-50">
              {t("labels.nodesAttached", { count: pool.provider_count })}
            </span>
          </div>
        </div>
        <div className="flex flex-col items-end">
          <div className="ws-num text-[14px] font-black tracking-tighter">{pool.health_score}</div>
          <div className={cn("ws-dot mt-1", pool.health_score > 80 ? "bg-[var(--ok)] shadow-[0_0_8px_var(--ok)]" : "bg-[var(--warn)]")} data-live={selected} />
        </div>
      </div>
    </button>
  );
}

function MemberGridNode({ member }: { member: LocalModelPoolStatus["members"][0] }) {
  const t = useTranslations("model-pools");
  const isHealthy = member.status.toLowerCase() === "active" || member.status.toLowerCase() === "online";

  return (
    <div className="group relative">
      <div className="ws-bezel h-full transition-all duration-500 group-hover:scale-[1.02] group-hover:shadow-2xl" style={MODEL_POOL_BEZEL_STYLE}>
        <div className="ws-bezel-inner flex flex-col border border-white/[0.02] bg-gradient-to-b from-white/[0.03] to-transparent p-4">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex size-8 items-center justify-center rounded-lg border border-white/[0.05] bg-[var(--window-bg)] shadow-inner transition-transform group-hover:rotate-6">
              <Zap className={cn("size-4", isHealthy ? "text-[var(--accent-strong)]" : "text-[var(--ink-4)]")} />
            </div>
            <div
              className={cn(
                "rounded-md border px-1.5 py-0.5 font-mono text-[8px] font-black uppercase tracking-widest transition-all",
                isHealthy ? "border-[var(--ok-border)] bg-[var(--ok-soft)] text-[var(--ok)]" : "border-transparent bg-[var(--panel-bg-inset)] text-[var(--ink-4)]"
              )}
            >
              {member.status}
            </div>
          </div>

          <h5 className="ws-control mb-1 truncate text-[13px] font-bold text-[var(--ink-2)] transition-colors group-hover:text-white">
            {member.display_name || member.model_id}
          </h5>
          <p className="ws-caption mb-4 truncate text-[10px] font-bold uppercase tracking-wider opacity-40">{member.instance_name}</p>

          <div className="mt-auto grid grid-cols-2 gap-2 border-t border-white/[0.03] pt-3">
            <div>
              <span className="mb-0.5 block text-[8px] font-black uppercase tracking-tighter text-[var(--ink-4)]">{t("labels.success")}</span>
              <span className="ws-num text-[11px] font-bold">{formatPercent(member.success_rate)}</span>
            </div>
            <div className="text-right">
              <span className="mb-0.5 block text-[8px] font-black uppercase tracking-tighter text-[var(--ink-4)]">{t("labels.latency")}</span>
              <span className="ws-num text-[11px] font-bold">{formatLatency(member.avg_latency_ms)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DesktopOnlyState() {
  const t = useTranslations("model-pools");

  return (
    <div className="flex h-[calc(100vh-var(--shell-toolbar-h))] flex-col items-center justify-center p-12 text-center">
      <div className="relative mb-10 flex size-24 items-center justify-center rounded-[40px] border border-[var(--hairline-strong)] bg-gradient-to-b from-[var(--panel-bg)] to-transparent shadow-2xl">
        <Cpu className="size-12 text-[var(--accent-strong)] opacity-60" />
      </div>
      <h3 className="ws-view-title mb-4 text-3xl font-black tracking-tighter">{t("desktopOnlyTitle")}</h3>
      <p className="ws-body mx-auto max-w-[360px] text-sm font-medium leading-relaxed opacity-60">{t("desktopOnlyDescription")}</p>
    </div>
  );
}

export function ModelPoolsPageClient() {
  const t = useTranslations("model-pools");
  const locale = useLocale();
  const [desktopReady, setDesktopReady] = React.useState<boolean | null>(null);
  const [selectedPoolKey, setSelectedPoolKey] = React.useState<string | null>(null);

  React.useEffect(() => {
    setDesktopReady(isTauriRuntime());
  }, []);

  const { data, isLoading } = useSWR<LocalModelPoolStatus[]>(desktopReady ? QUERY_KEY : null, fetchLocalModelPoolsStatus, {
    revalidateOnFocus: false,
  });

  const pools = React.useMemo(() => data ?? [], [data]);

  React.useEffect(() => {
    if (!pools.length) {
      setSelectedPoolKey(null);
      return;
    }

    if (!selectedPoolKey || !pools.some((pool) => pool.pool_key === selectedPoolKey)) {
      setSelectedPoolKey(pools[0].pool_key);
    }
  }, [pools, selectedPoolKey]);

  const selectedPool = pools.find((pool) => pool.pool_key === selectedPoolKey) ?? pools[0] ?? null;
  const summary = React.useMemo(() => {
    const totalPools = pools.length;
    const totalSessions = pools.reduce((sum, pool) => sum + pool.active_session_count, 0);
    const coolingProviders = pools.reduce((sum, pool) => sum + pool.cooling_down_count, 0);
    const health = totalPools ? Math.round(pools.reduce((sum, pool) => sum + pool.health_score, 0) / totalPools) : 0;
    return { totalPools, totalSessions, coolingProviders, health };
  }, [pools]);

  if (desktopReady === false) {
    return <DesktopOnlyState />;
  }

  return (
    <div className="relative -mb-[var(--shell-canvas-pb)] -mt-[var(--shell-canvas-pt)] flex h-[calc(100vh-var(--shell-toolbar-h))] flex-col overflow-hidden bg-[var(--window-bg)] -mx-[var(--shell-canvas-px)]">
      <header className="relative z-30 flex h-[64px] flex-none items-center justify-between border-b border-[var(--hairline)] bg-[var(--panel-bg-inset)]/30 px-8 backdrop-blur-xl">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-2xl bg-[var(--accent-strong)] text-white shadow-lg shadow-[var(--accent-soft)]">
              <Waves className="size-5" />
            </div>
            <h1 className="ws-view-title text-xl font-black tracking-tighter">{t("title")}</h1>
          </div>
          <div className="h-5 w-px bg-[var(--hairline-strong)]" />

          <div className="hidden items-center gap-6 xl:flex">
            <div className="flex items-center gap-3">
              <span className="ws-meta text-[9px] font-black tracking-widest opacity-40">{t("workstation.systemHealth")}</span>
              <div className="flex items-center gap-2 rounded-full border border-[var(--hairline)] bg-[var(--panel-bg)] px-2.5 py-1 shadow-inner">
                <div className={cn("h-1.5 w-1.5 animate-pulse rounded-full shadow-[0_0_8px_var(--ok)]", summary.health > 80 ? "bg-[var(--ok)]" : "bg-[var(--warn)]")} />
                <span className="ws-num text-[11px] font-black">{summary.health}%</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="ws-meta text-[9px] font-black tracking-widest opacity-40">{t("workstation.activeSessions")}</span>
              <span className="ws-num text-[15px] font-black tracking-tighter">{summary.totalSessions}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--ink-4)]">
          <div className="flex items-center gap-2 rounded-xl border border-[var(--hairline)] bg-white/[0.02] px-3 py-1.5">
            <span className="opacity-40">{t("workstation.cooling")}</span>
            <span className={cn("font-black", summary.coolingProviders > 0 ? "text-[var(--danger)]" : "text-[var(--ok)]")}>{summary.coolingProviders}</span>
          </div>
        </div>
      </header>

      <div className="relative z-20 flex flex-1 overflow-hidden">
        <aside className="relative flex w-[320px] flex-none flex-col overflow-hidden border-r border-[var(--hairline)] bg-[var(--sidebar-bg)]/30 backdrop-blur-md">
          <div className="flex-none px-7 pb-4 pt-7">
            <p className="ws-meta text-[9px] font-black uppercase tracking-[0.4em] opacity-30">{t("sections.directory")}</p>
          </div>

          <div className="relative z-20 flex-1 space-y-2 overflow-y-auto px-4 pb-12 custom-scrollbar">
            {isLoading ? (
              <div className="space-y-4 px-2">
                <Skeleton className="h-20 rounded-3xl bg-[var(--panel-bg-inset)] opacity-40" />
                <Skeleton className="h-20 rounded-3xl bg-[var(--panel-bg-inset)] opacity-40" />
              </div>
            ) : (
              pools.map((pool) => <PoolNode key={pool.pool_key} onClick={() => setSelectedPoolKey(pool.pool_key)} pool={pool} selected={pool.pool_key === selectedPoolKey} />)
            )}
          </div>
        </aside>

        <main className="relative flex-1 overflow-y-auto bg-[var(--window-bg)] custom-scrollbar">
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="mesh-grid absolute inset-0 opacity-[0.03]" />
            <div className="absolute bottom-[-10%] left-[20%] h-[800px] w-[800px] rounded-full bg-[radial-gradient(circle,var(--accent-soft)_0%,transparent_70%)] opacity-10 blur-3xl" />
          </div>

          <div className="relative z-10 max-w-[1400px] p-10">
            {selectedPool ? (
              <div className="animate-in space-y-12 fade-in slide-in-from-bottom-4 duration-700">
                <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <div className="mb-4 flex items-center gap-3">
                      <div className="h-px w-8 bg-[var(--accent-strong)] opacity-40" />
                      <span className="ws-meta text-[10px] font-black uppercase tracking-[0.4em] text-[var(--accent-strong)]">{t("workstation.subsystemFocus")}</span>
                    </div>
                    <h2 className="ws-view-title mb-4 text-5xl font-black tracking-tighter">{selectedPool.display_name}</h2>
                    <p className="ws-body max-w-xl text-base font-medium leading-relaxed text-[var(--ink-3)]">{t("descriptions.focusExtended")}</p>
                  </div>

                  <div className="flex gap-4">
                    <div className="ws-bezel min-w-[140px]" style={MODEL_POOL_BEZEL_STYLE}>
                      <div className="ws-bezel-inner bg-white/[0.02] p-4 text-center">
                        <div className="ws-meta mb-1 text-[8px] font-black tracking-widest opacity-40">{t("workstation.successRate")}</div>
                        <div className="ws-num text-2xl font-black">{formatPercent(selectedPool.success_rate)}</div>
                      </div>
                    </div>
                    <div className="ws-bezel min-w-[140px]" style={MODEL_POOL_BEZEL_STYLE}>
                      <div className="ws-bezel-inner bg-white/[0.02] p-4 text-center">
                        <div className="ws-meta mb-1 text-[8px] font-black tracking-widest opacity-40">{t("workstation.avgLatency")}</div>
                        <div className="ws-num text-2xl font-black tracking-tighter">{formatLatency(selectedPool.avg_latency_ms)}</div>
                      </div>
                    </div>
                  </div>
                </div>

                <section>
                  <div className="mb-8 flex items-center gap-4">
                    <h3 className="ws-pane-title text-sm font-black uppercase tracking-[0.25em] opacity-60">{t("sections.members")}</h3>
                    <div className="h-px flex-1 bg-gradient-to-r from-[var(--hairline-strong)] to-transparent" />
                  </div>
                  <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                    {selectedPool.members.map((member) => (
                      <MemberGridNode key={member.provider_model_id} member={member} />
                    ))}
                    {!selectedPool.members.length ? (
                      <div className="col-span-full rounded-[32px] border-2 border-dashed border-[var(--hairline)] bg-white/[0.01] py-20 text-center text-xs font-black uppercase tracking-widest opacity-40">
                        {t("empty.members")}
                      </div>
                    ) : null}
                  </div>
                </section>

                <section className="pb-20">
                  <div className="mb-8 flex items-center gap-4">
                    <h3 className="ws-pane-title text-sm font-black uppercase tracking-[0.25em] opacity-60">{t("sections.bindings")}</h3>
                    <div className="h-px flex-1 bg-gradient-to-r from-[var(--hairline-strong)] to-transparent" />
                  </div>
                  <div className="overflow-hidden rounded-[32px] border border-[var(--hairline)] bg-[var(--panel-bg)]/40 shadow-2xl backdrop-blur-md">
                    <Table>
                      <TableHeader className="border-b border-[var(--hairline)] bg-white/[0.02]">
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="ws-meta py-4 pl-8 text-[10px] font-black">{t("labels.boundProvider")}</TableHead>
                          <TableHead className="ws-meta py-4 text-[10px] font-black">{t("labels.lastActive")}</TableHead>
                          <TableHead className="ws-meta py-4 pr-8 text-right text-[10px] font-black tracking-widest">{t("workstation.bindingId")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedPool.bindings.map((binding) => (
                          <TableRow key={`${binding.session_id}:${binding.pinned_provider_model_id}`} className="border-b border-white/[0.02] transition-colors hover:bg-[var(--accent-soft)]/20">
                            <TableCell className="py-5 pl-8">
                              <div className="text-[13px] font-bold text-[var(--ink-2)]">{binding.title || t("workstation.anonymousSession")}</div>
                              <div className="mt-1 font-mono text-[9px] font-black uppercase tracking-wider text-[var(--ink-4)]">{binding.pinned_provider_model_id}</div>
                            </TableCell>
                            <TableCell className="ws-num text-[12px] font-medium opacity-60">{formatDate(binding.last_active_at || binding.updated_at, locale)}</TableCell>
                            <TableCell className="pr-8 text-right font-mono text-[10px] font-black opacity-30">{binding.session_id.slice(0, 8)}...</TableCell>
                          </TableRow>
                        ))}
                        {!selectedPool.bindings.length ? (
                          <TableRow>
                            <TableCell className="py-20 text-center text-[10px] font-black uppercase tracking-widest opacity-40" colSpan={3}>
                              {t("empty.bindings")}
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </TableBody>
                    </Table>
                  </div>
                </section>
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center p-20 text-center">
                <div className="relative mb-12">
                  <div className="absolute -inset-10 animate-pulse rounded-full bg-[var(--accent-soft)] opacity-20 blur-3xl" />
                  <div className="relative flex size-24 items-center justify-center rounded-[40px] border border-[var(--hairline-strong)] bg-gradient-to-b from-[var(--panel-bg)] to-transparent shadow-2xl">
                    <Waves className="size-12 text-[var(--accent-strong)] opacity-60" />
                  </div>
                </div>
                <h3 className="ws-view-title mb-4 text-3xl font-black uppercase tracking-[0.2em] tracking-tighter opacity-30">{t("workstation.selectPool")}</h3>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
