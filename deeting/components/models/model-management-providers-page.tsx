"use client";

import * as React from "react";
import { Bot, Server, MoreHorizontal, Layers } from "lucide-react";
import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/shadcn/skeleton";
import { ProviderIcon } from "@/components/models/provider-icon";
import { useProviderInstances } from "@/hooks/use-providers";
import { ModelsManager } from "@/components/models/models-manager";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/shadcn/dropdown-menu";

export function ModelManagementProvidersPage() {
  const t = useTranslations("providers.manager");
  const { instances, isLoading } = useProviderInstances({ include_public: true });
  const [selectedInstanceId, setSelectedInstanceId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!instances.length) {
      setSelectedInstanceId(null);
      return;
    }
    if (!selectedInstanceId || !instances.some((instance) => instance.id === selectedInstanceId)) {
      setSelectedInstanceId(instances[0].id);
    }
  }, [instances, selectedInstanceId]);

  return (
    <div className="flex flex-col bg-[var(--window-bg)] overflow-hidden -mx-[var(--shell-canvas-px)] -mt-[var(--shell-canvas-pt)] -mb-[var(--shell-canvas-pb)] h-[calc(100vh-var(--shell-toolbar-h))] relative">
      {/* Workstation Command Header */}
      <header className="flex h-[56px] flex-none items-center justify-between border-b border-[var(--hairline)] bg-[var(--panel-bg-inset)]/30 px-6 backdrop-blur-xl relative z-30">
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-3">
            <div className="flex size-8 items-center justify-center rounded-xl bg-[var(--accent-strong)] text-white shadow-[0_0_20px_var(--accent-soft)] transition-transform hover:scale-110 active:rotate-12">
              <Layers className="size-4.5" />
            </div>
            <h1 className="ws-view-title text-lg tracking-tighter">{t("title")}</h1>
          </div>
          <div className="h-4 w-px bg-[var(--hairline-strong)]" />
          <div className="flex items-center gap-3">
             <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--window-bg)] border border-[var(--hairline)] shadow-inner">
                <div className="w-1.5 h-1.5 rounded-full bg-[var(--ok)] shadow-[0_0_8px_var(--ok)] animate-pulse" />
                <span className="ws-num text-[10px] font-black text-[var(--ink-2)] tracking-widest uppercase">
                   {t("workstation.liveNodes", { count: instances.length })}
                </span>
             </div>
          </div>
        </div>
        
        <div className="flex items-center gap-6">
           <div className="hidden lg:flex items-center gap-4 text-[9px] font-mono font-bold text-[var(--ink-4)] uppercase tracking-[0.2em]">
              <div className="flex items-center gap-1.5">
                 <span className="opacity-40">{t("workstation.latencyMetric")}</span>
                 <span className="text-[var(--ok)]">{t("workstation.stable")}</span>
              </div>
              <div className="h-2 w-px bg-[var(--hairline)]" />
              <div className="flex items-center gap-1.5">
                 <span className="opacity-40">{t("workstation.versionMetric")}</span>
                 <span className="text-[var(--ink-2)]">0.1.1-3</span>
              </div>
           </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden relative z-20">
        {/* Sidebar: Neural Link Navigator */}
        <aside className="flex w-[310px] flex-none flex-col overflow-hidden border-r border-[var(--hairline)] bg-[var(--sidebar-bg)]/30 backdrop-blur-md relative">
          <div className="flex-none px-6 pb-4 pt-6">
            <p className="ws-meta text-[9px] uppercase tracking-[0.3em] font-black opacity-30">{t("workstation.channelRegistry")}</p>
          </div>
          
          <div className="flex-1 space-y-2 overflow-y-auto px-4 pb-12 custom-scrollbar">
            {isLoading ? (
              <div className="space-y-4 px-2">
                <Skeleton className="h-20 rounded-2xl bg-[var(--panel-bg-inset)] opacity-40" />
                <Skeleton className="h-20 rounded-2xl bg-[var(--panel-bg-inset)] opacity-40" />
              </div>
            ) : instances.length ? (
              instances.map((instance) => {
                const selected = instance.id === selectedInstanceId;
                return (
                  <div key={instance.id} className="group relative">
                    <button
                      type="button"
                      onClick={() => setSelectedInstanceId(instance.id)}
                      className={cn(
                        "ws-rail relative flex w-full flex-col gap-2 rounded-[24px] border p-4 pr-12 text-left transition-all duration-500",
                        selected
                          ? "border-[var(--accent-border)] bg-gradient-to-br from-[var(--accent-soft)]/60 to-transparent shadow-[0_30px_60px_-20px_rgba(0,0,0,0.4)]"
                          : "border-transparent bg-transparent hover:border-[var(--hairline)] hover:bg-[var(--panel-bg-inset)]/50"
                      )}
                    >
                    {/* Active Link Energy Guide */}
                    {selected && (
                       <div className="absolute left-[-16px] top-1/4 bottom-1/4 w-1 bg-[var(--accent-strong)] rounded-r-full shadow-[6px_0_15px_var(--accent-strong)]" />
                    )}

                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-3.5 min-w-0">
                        <div className={cn(
                          "flex size-10 flex-none items-center justify-center rounded-2xl border transition-all duration-700",
                          selected 
                            ? "border-[var(--accent-border)] bg-[var(--panel-bg)] shadow-[inset_0_2px_10px_rgba(0,0,0,0.1)] scale-110 rotate-[-4deg]" 
                            : "border-[var(--hairline)] bg-[var(--panel-bg-inset)] opacity-60"
                        )}>
                          <ProviderIcon
                            src={instance.icon}
                            className="size-5.5 flex-none transition-transform group-hover:scale-110"
                            fallback={<Server className={cn("size-4.5 flex-none", selected ? "text-[var(--accent-strong)]" : "text-[var(--ink-4)]")} />}
                          />
                        </div>
                        <div className="min-w-0">
                          <span className={cn(
                            "ws-control block truncate text-[14px] transition-colors leading-tight",
                            selected ? "font-black text-[var(--ink)] tracking-tighter" : "font-bold text-[var(--ink-2)]"
                          )}>{instance.name}</span>
                          <span className="mt-1 block truncate font-mono text-[9px] font-black text-[var(--ink-4)] opacity-50 tracking-widest uppercase">
                            {instance.base_url.replace(/^https?:\/\//, '').split('/')[0]}
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <div className={cn("ws-dot transition-all duration-700", instance.is_enabled ? "bg-[var(--ok)] shadow-[0_0_10px_var(--ok)]" : "bg-[var(--ink-4)]")} data-live={instance.is_enabled && selected} />
                      </div>
                    </div>
                    
                    <div className="flex items-center pl-[54px] mt-1">
                       <div className={cn(
                         "rounded-md px-2 py-0.5 text-[9px] font-black uppercase tracking-widest border transition-all",
                         instance.is_enabled
                           ? "bg-[var(--ok-soft)] text-[var(--ok)] border-[var(--ok-border)]"
                           : "bg-[var(--panel-bg-inset)] text-[var(--ink-4)] border-transparent"
                       )}>
                          {instance.is_enabled ? t("workstation.linkedOnline") : t("workstation.nodeOffline")}
                       </div>
                    </div>
                    </button>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label={`${instance.name} actions`}
                          onClick={(event) => event.stopPropagation()}
                          className="absolute bottom-4 right-4 z-20 rounded-xl p-1.5 opacity-0 transition-all hover:bg-[var(--panel-bg)] group-hover:opacity-100 data-[state=open]:opacity-100 data-[state=open]:bg-[var(--panel-bg)]"
                        >
                          <MoreHorizontal className="size-4 text-[var(--ink-3)]" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        className="ws-bezel-inner min-w-[170px] shadow-[0_40px_80px_rgba(0,0,0,0.5)] border-[var(--hairline-strong)] backdrop-blur-2xl p-1.5"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <DropdownMenuItem className="ws-control text-[12px] py-2.5 px-4 font-black tracking-tight cursor-pointer rounded-xl focus:bg-[var(--accent-soft)] focus:text-[var(--accent-ink)] transition-colors transition-all mb-1">{t("edit").toUpperCase()}</DropdownMenuItem>
                        <DropdownMenuItem className="ws-control text-[12px] py-2.5 px-4 font-black tracking-tight cursor-pointer rounded-xl text-[var(--danger)] focus:bg-[var(--danger-soft)] focus:text-[var(--danger)] transition-all">{t("disconnect").toUpperCase()}</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                );
              })
            ) : (
              <div className="mx-2 mt-8 rounded-[32px] border border-dashed border-[var(--hairline-strong)] p-10 text-center bg-white/[0.02] backdrop-blur-md">
                <Bot className="size-10 text-[var(--ink-4)] mx-auto mb-4 opacity-10 animate-pulse" />
                <p className="ws-caption text-xs font-black uppercase tracking-widest opacity-40">{t("empty")}</p>
              </div>
            )}
          </div>
        </aside>

        {/* Main Workspace: Neural Matrix */}
        <main className="flex-1 overflow-hidden bg-[var(--window-bg)] relative">
          {/* Subtle Dynamic Mesh Background */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
             <div className="absolute inset-0 opacity-[0.03] mesh-grid" />
             <div className="absolute top-[20%] right-[-10%] w-[600px] h-[600px] rounded-full bg-[radial-gradient(circle,var(--accent-soft)_0%,transparent_70%)] blur-3xl opacity-10" />
          </div>
          
          <div className="relative z-10 h-full">
            {selectedInstanceId ? (
              <div className="h-full overflow-y-auto custom-scrollbar">
                <ModelsManager instanceId={selectedInstanceId} />
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center p-12 text-center">
                 <div className="relative">
                    <div className="absolute -inset-8 bg-[var(--accent-soft)] opacity-20 blur-3xl rounded-full animate-pulse" />
                    <div className="relative mb-10 flex size-24 items-center justify-center rounded-[40px] border border-[var(--hairline-strong)] bg-gradient-to-b from-[var(--panel-bg)] to-transparent shadow-2xl">
                       <Bot className="size-12 text-[var(--accent-strong)] opacity-60" />
                    </div>
                 </div>
                 <h3 className="ws-view-title text-[var(--ink-2)] text-3xl mb-4 tracking-tighter font-black">{t("workstation.linkStandbyTitle")}</h3>
                 <p className="ws-body text-[var(--ink-3)] text-sm max-w-[360px] leading-relaxed mx-auto font-medium opacity-60">
                    {t("workstation.linkStandbyDescription")}
                 </p>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
