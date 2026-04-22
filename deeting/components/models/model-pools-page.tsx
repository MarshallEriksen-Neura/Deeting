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

function PoolNode({ pool, selected, onClick }: { pool: LocalModelPoolStatus, selected: boolean, onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "ws-rail group relative flex w-full flex-col gap-3 rounded-[24px] border p-5 text-left transition-all duration-500",
        selected
          ? "border-[var(--accent-border)] bg-gradient-to-br from-[var(--accent-soft)]/60 to-transparent shadow-[0_30px_60px_-20px_rgba(109,92,255,0.3)]"
          : "border-transparent bg-transparent hover:border-[var(--hairline)] hover:bg-[var(--panel-bg-inset)]/50"
      )}
    >
      {selected && (
        <div className="absolute left-[-16px] top-1/4 bottom-1/4 w-1 bg-[var(--accent-strong)] rounded-r-full shadow-[6px_0_15px_var(--accent-strong)]" />
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={cn(
            "flex size-10 items-center justify-center rounded-2xl border transition-all duration-700",
            selected ? "border-[var(--accent-border)] bg-[var(--panel-bg)] shadow-md rotate-[-6deg] scale-110" : "border-[var(--hairline)] bg-[var(--panel-bg-inset)] opacity-60"
          )}>
            <Cpu className={cn("size-5", selected ? "text-[var(--accent-strong)]" : "text-[var(--ink-4)]")} />
          </div>
          <div>
            <h4 className={cn("ws-control block truncate text-[15px] transition-colors leading-tight", selected ? "font-black text-[var(--ink)] tracking-tighter" : "font-bold text-[var(--ink-2)]")}>
              {pool.display_name}
            </h4>
            <span className="mt-1 block font-mono text-[9px] font-black text-[var(--ink-4)] opacity-50 tracking-[0.2em] uppercase">
              {pool.provider_count} NODES_ATTACHED
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

function MemberGridNode({ member }: { member: LocalModelPoolStatus['members'][0] }) {
  const isHealthy = member.status.toLowerCase() === 'active' || member.status.toLowerCase() === 'online';
  return (
    <div className="group relative">
      <div className="ws-bezel h-full transition-all duration-500 group-hover:scale-[1.02] group-hover:shadow-2xl">
        <div className="ws-bezel-inner flex flex-col p-4 bg-gradient-to-b from-white/[0.03] to-transparent border border-white/[0.02]">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex size-8 items-center justify-center rounded-lg bg-[var(--window-bg)] border border-white/[0.05] shadow-inner transition-transform group-hover:rotate-6">
              <Zap className={cn("size-4", isHealthy ? "text-[var(--accent-strong)]" : "text-[var(--ink-4)]")} />
            </div>
            <div className={cn(
              "rounded-md px-1.5 py-0.5 font-mono text-[8px] font-black uppercase tracking-widest border transition-all",
              isHealthy ? "bg-[var(--ok-soft)] text-[var(--ok)] border-[var(--ok-border)]" : "bg-[var(--panel-bg-inset)] text-[var(--ink-4)] border-transparent"
            )}>
              {member.status}
            </div>
          </div>

          <h5 className="ws-control mb-1 truncate text-[13px] font-bold text-[var(--ink-2)] group-hover:text-white transition-colors">
            {member.display_name || member.model_id}
          </h5>
          <p className="ws-caption mb-4 truncate text-[10px] opacity-40 font-bold uppercase tracking-wider">{member.instance_name}</p>

          <div className="mt-auto grid grid-cols-2 gap-2 border-t border-white/[0.03] pt-3">
            <div>
              <span className="block text-[8px] font-black text-[var(--ink-4)] uppercase tracking-tighter mb-0.5">Success</span>
              <span className="ws-num text-[11px] font-bold">{formatPercent(member.success_rate)}</span>
            </div>
            <div className="text-right">
              <span className="block text-[8px] font-black text-[var(--ink-4)] uppercase tracking-tighter mb-0.5">Latency</span>
              <span className="ws-num text-[11px] font-bold">{formatLatency(member.avg_latency_ms)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ModelPoolsPage() {
  const t = useTranslations("model-pools");
  const locale = useLocale();
  const [desktopReady, setDesktopReady] = React.useState<boolean | null>(null);
  const [selectedPoolKey, setSelectedPoolKey] = React.useState<string | null>(null);

  React.useEffect(() => {
    setDesktopReady(isTauriRuntime());
  }, []);

  const { data, isLoading } = useSWR<LocalModelPoolStatus[]>(
    desktopReady ? QUERY_KEY : null,
    fetchLocalModelPoolsStatus,
    { revalidateOnFocus: false }
  );

  const pools = data ?? [];

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
    return (
      <div className="flex h-[calc(100vh-var(--shell-toolbar-h))] flex-col items-center justify-center p-12 text-center">
         <div className="relative mb-10 flex size-24 items-center justify-center rounded-[40px] border border-[var(--hairline-strong)] bg-gradient-to-b from-[var(--panel-bg)] to-transparent shadow-2xl">
            <Cpu className="size-12 text-[var(--accent-strong)] opacity-60" />
         </div>
         <h3 className="ws-view-title text-3xl mb-4 tracking-tighter font-black">{t("desktopOnlyTitle")}</h3>
         <p className="ws-body text-sm max-w-[360px] leading-relaxed mx-auto font-medium opacity-60">{t("desktopOnlyDescription")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col bg-[var(--window-bg)] overflow-hidden -mx-[var(--shell-canvas-px)] -mt-[var(--shell-canvas-pt)] -mb-[var(--shell-canvas-pb)] h-[calc(100vh-var(--shell-toolbar-h))] relative">
      {/* Dynamic HUD Header */}
      <header className="flex h-[64px] flex-none items-center justify-between border-b border-[var(--hairline)] bg-[var(--panel-bg-inset)]/30 px-8 backdrop-blur-xl relative z-30">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
             <div className="flex size-9 items-center justify-center rounded-2xl bg-[var(--accent-strong)] text-white shadow-lg shadow-[var(--accent-soft)]">
                <Waves className="size-5" />
             </div>
             <h1 className="ws-view-title text-xl tracking-tighter font-black">{t("title")}</h1>
          </div>
          <div className="h-5 w-px bg-[var(--hairline-strong)]" />

          <div className="hidden xl:flex items-center gap-6">
            <div className="flex items-center gap-3">
              <span className="ws-meta text-[9px] opacity-40 font-black tracking-widest">SYSTEM_HEALTH</span>
              <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-[var(--panel-bg)] border border-[var(--hairline)] shadow-inner">
                 <div className={cn("w-1.5 h-1.5 rounded-full shadow-[0_0_8px_var(--ok)] animate-pulse", summary.health > 80 ? "bg-[var(--ok)]" : "bg-[var(--warn)]")} />
                 <span className="ws-num text-[11px] font-black">{summary.health}%</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="ws-meta text-[9px] opacity-40 font-black tracking-widest">ACTIVE_SESSIONS</span>
              <span className="ws-num text-[15px] font-black tracking-tighter">{summary.totalSessions}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4 text-[10px] text-[var(--ink-4)] font-mono uppercase tracking-[0.2em]">
           <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-[var(--hairline)] bg-white/[0.02]">
              <span className="opacity-40">Cooling:</span>
              <span className={cn("font-black", summary.coolingProviders > 0 ? "text-[var(--danger)]" : "text-[var(--ok)]")}>{summary.coolingProviders}</span>
           </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden relative z-20">
        {/* Sidebar: Pool Registry */}
        <aside className="flex w-[320px] flex-none flex-col overflow-hidden border-r border-[var(--hairline)] bg-[var(--sidebar-bg)]/30 backdrop-blur-md relative">
          <div className="flex-none px-7 pb-4 pt-7">
            <p className="ws-meta text-[9px] uppercase tracking-[0.4em] font-black opacity-30">{t("sections.directory")}</p>
          </div>

          <div className="flex-1 space-y-2 overflow-y-auto px-4 pb-12 custom-scrollbar relative z-20">
            {isLoading ? (
              <div className="space-y-4 px-2">
                <Skeleton className="h-20 rounded-3xl bg-[var(--panel-bg-inset)] opacity-40" />
                <Skeleton className="h-20 rounded-3xl bg-[var(--panel-bg-inset)] opacity-40" />
              </div>
            ) : pools.map((pool) => (
              <PoolNode 
                key={pool.pool_key} 
                pool={pool} 
                selected={pool.pool_key === selectedPoolKey}
                onClick={() => setSelectedPoolKey(pool.pool_key)}
              />
            ))}
          </div>
        </aside>

        {/* Main Content: Focal System View */}
        <main className="flex-1 overflow-y-auto bg-[var(--window-bg)] relative custom-scrollbar">
          {/* Ambient Rendering */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
             <div className="absolute inset-0 opacity-[0.03] mesh-grid" />
             <div className="absolute bottom-[-10%] left-[20%] w-[800px] h-[800px] rounded-full bg-[radial-gradient(circle,var(--accent-soft)_0%,transparent_70%)] blur-3xl opacity-10" />
          </div>

          <div className="relative z-10 p-10 max-w-[1400px]">
            {selectedPool ? (
              <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-700">
                {/* Pool Header Info */}
                <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <div className="flex items-center gap-3 mb-4">
                      <div className="h-px w-8 bg-[var(--accent-strong)] opacity-40" />
                      <span className="ws-meta text-[10px] font-black tracking-[0.4em] text-[var(--accent-strong)] uppercase">Subsystem_Focus</span>
                    </div>
                    <h2 className="ws-view-title text-5xl font-black tracking-tighter mb-4">{selectedPool.display_name}</h2>
                    <p className="ws-body text-[var(--ink-3)] text-base font-medium max-w-xl leading-relaxed">
                      {t("descriptions.focus")}. This pool acts as a high-availability nexus for model distribution.
                    </p>
                  </div>

                  <div className="flex gap-4">
                    <div className="ws-bezel min-w-[140px]">
                      <div className="ws-bezel-inner p-4 text-center bg-white/[0.02]">
                        <div className="ws-meta text-[8px] font-black opacity-40 tracking-widest mb-1">SUCCESS_RATE</div>
                        <div className="ws-num text-2xl font-black">{formatPercent(selectedPool.success_rate)}</div>
                      </div>
                    </div>
                    <div className="ws-bezel min-w-[140px]">
                      <div className="ws-bezel-inner p-4 text-center bg-white/[0.02]">
                        <div className="ws-meta text-[8px] font-black opacity-40 tracking-widest mb-1">AVG_LATENCY</div>
                        <div className="ws-num text-2xl font-black tracking-tighter">{formatLatency(selectedPool.avg_latency_ms)}</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Member Nodes Matrix */}
                <section>
                  <div className="flex items-center gap-4 mb-8">
                    <h3 className="ws-pane-title text-sm font-black uppercase tracking-[0.25em] opacity-60">{t("sections.members")}</h3>
                    <div className="h-px flex-1 bg-gradient-to-r from-[var(--hairline-strong)] to-transparent" />
                  </div>
                  <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                    {selectedPool.members.map((member) => (
                      <MemberGridNode key={member.provider_model_id} member={member} />
                    ))}
                    {!selectedPool.members.length && (
                      <div className="col-span-full py-20 rounded-[32px] border-2 border-dashed border-[var(--hairline)] bg-white/[0.01] text-center opacity-40 uppercase tracking-widest font-black text-xs">
                        {t("empty.members")}
                      </div>
                    )}
                  </div>
                </section>

                {/* Session Bindings Overlay */}
                <section className="pb-20">
                   <div className="flex items-center gap-4 mb-8">
                      <h3 className="ws-pane-title text-sm font-black uppercase tracking-[0.25em] opacity-60">{t("sections.bindings")}</h3>
                      <div className="h-px flex-1 bg-gradient-to-r from-[var(--hairline-strong)] to-transparent" />
                   </div>
                   <div className="rounded-[32px] border border-[var(--hairline)] bg-[var(--panel-bg)]/40 backdrop-blur-md overflow-hidden shadow-2xl">
                      <Table>
                        <TableHeader className="bg-white/[0.02] border-b border-[var(--hairline)]">
                          <TableRow className="hover:bg-transparent">
                            <TableHead className="ws-meta text-[10px] font-black py-4 pl-8">{t("labels.boundProvider")}</TableHead>
                            <TableHead className="ws-meta text-[10px] font-black py-4">{t("labels.lastActive")}</TableHead>
                            <TableHead className="ws-meta text-[10px] font-black py-4 text-right pr-8 tracking-widest">BINDING_ID</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {selectedPool.bindings.map((binding) => (
                            <TableRow key={`${binding.session_id}:${binding.pinned_provider_model_id}`} className="border-b border-white/[0.02] transition-colors hover:bg-[var(--accent-soft)]/20">
                              <TableCell className="py-5 pl-8">
                                <div className="font-bold text-[var(--ink-2)] text-[13px]">{binding.title || "Anonymous Session"}</div>
                                <div className="mt-1 font-mono text-[9px] text-[var(--ink-4)] font-black uppercase tracking-wider">{binding.pinned_provider_model_id}</div>
                              </TableCell>
                              <TableCell className="ws-num text-[12px] opacity-60 font-medium">
                                {formatDate(binding.last_active_at || binding.updated_at, locale)}
                              </TableCell>
                              <TableCell className="text-right pr-8 font-mono text-[10px] opacity-30 font-black">
                                {binding.session_id.slice(0, 8)}...
                              </TableCell>
                            </TableRow>
                          ))}
                          {!selectedPool.bindings.length && (
                            <TableRow>
                              <TableCell colSpan={3} className="py-20 text-center opacity-40 uppercase tracking-widest font-black text-[10px]">
                                {t("empty.bindings")}
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                   </div>
                </section>
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center p-20 text-center">
                 <div className="relative mb-12">
                    <div className="absolute -inset-10 bg-[var(--accent-soft)] opacity-20 blur-3xl rounded-full animate-pulse" />
                    <div className="relative flex size-24 items-center justify-center rounded-[40px] border border-[var(--hairline-strong)] bg-gradient-to-b from-[var(--panel-bg)] to-transparent shadow-2xl">
                       <Waves className="size-12 text-[var(--accent-strong)] opacity-60" />
                    </div>
                 </div>
                 <h3 className="ws-view-title text-3xl mb-4 tracking-tighter font-black opacity-30 uppercase tracking-[0.2em]">Select Neural Nexus</h3>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
