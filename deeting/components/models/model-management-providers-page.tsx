"use client";

import * as React from "react";
import { Bot, Server, MoreHorizontal, Layers } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/shadcn/badge";
import { Skeleton } from "@/components/ui/shadcn/skeleton";
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
    <div className="flex flex-col bg-[var(--window-bg)] overflow-hidden -mx-[var(--shell-canvas-px)] -mt-[var(--shell-canvas-pt)] -mb-[var(--shell-canvas-pb)] h-[calc(100vh-var(--shell-toolbar-h))]">
        {/* Workstation Header */}
      <header className="flex h-[56px] flex-none items-center justify-between border-b border-[var(--hairline)] bg-[var(--panel-bg-inset)]/30 px-6 backdrop-blur-md">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-strong)]">
              <Layers className="size-4.5" />
            </div>
            <h1 className="ws-view-title">{t("title")}</h1>
          </div>
          <div className="h-4 w-px bg-[var(--hairline-strong)]" />
          <div className="flex items-center gap-2">
             <Badge variant="secondary" className="h-6 rounded-full border-[var(--hairline)] bg-[var(--panel-bg)] px-2.5 py-0 text-[10px] font-medium text-[var(--ink-3)]">
                {instances.length} channels
             </Badge>
          </div>
        </div>
        
       
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar: Neural Channel Navigator */}
        <aside className="flex w-[292px] flex-none flex-col overflow-hidden border-r border-[var(--hairline)] bg-[linear-gradient(180deg,rgba(255,255,255,0.82),rgba(242,242,245,0.6))] shadow-[14px_0_30px_-28px_rgba(15,17,28,0.3)]">
          <div className="flex-none px-5 pb-3 pt-4">
            <p className="ws-meta text-[9px] uppercase tracking-[0.18em] opacity-55">{t("localTag")}</p>
          </div>
          
          <div className="flex-1 space-y-1 overflow-y-auto px-3 pb-6 custom-scrollbar">
            {isLoading ? (
              <div className="space-y-3 px-3 mt-2">
                <Skeleton className="h-14 rounded-xl bg-[var(--hairline-subtle)]" />
                <Skeleton className="h-14 rounded-xl bg-[var(--hairline-subtle)]" />
                <Skeleton className="h-14 rounded-xl bg-[var(--hairline-subtle)]" />
              </div>
            ) : instances.length ? (
              instances.map((instance) => {
                const selected = instance.id === selectedInstanceId;
                return (
                  <button
                    key={instance.id}
                    onClick={() => setSelectedInstanceId(instance.id)}
                    className={cn(
                      "ws-rail group relative flex w-full flex-col gap-2 rounded-[20px] border px-4 py-3.5 text-left transition-all",
                      selected
                        ? "border-[var(--accent-border)] bg-[var(--accent-soft)]/55 shadow-[0_18px_34px_-28px_rgba(109,92,255,0.55)]"
                        : "border-transparent bg-transparent hover:border-[var(--hairline)] hover:bg-[var(--panel-bg)]/72"
                    )}
                    data-active={selected}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className={cn(
                          "flex size-8 items-center justify-center rounded-xl border transition-colors",
                          selected ? "border-[var(--accent-border)] bg-[var(--panel-bg)] shadow-sm" : "border-[var(--hairline)] bg-[var(--panel-bg-inset)]"
                        )}>
                          {instance.icon ? (
                             <img src={instance.icon} className="size-4.5 flex-none opacity-90" alt="" />
                          ) : (
                             <Server className={cn("size-3.5 flex-none", selected ? "text-[var(--accent-strong)]" : "text-[var(--ink-3)]")} />
                          )}
                        </div>
                        <div className="min-w-0">
                          <span className={cn(
                            "ws-control block truncate text-[13px] transition-colors",
                            selected ? "font-bold text-[var(--ink)]" : "text-[var(--ink-2)]"
                          )}>{instance.name}</span>
                          <span className="mt-0.5 block truncate text-[10px] font-medium text-[var(--ink-4)]">
                            {instance.base_url.replace(/^https?:\/\//, '').split('/')[0]}
                          </span>
                        </div>
                      </div>
                      <div className={cn("ws-dot", instance.is_enabled ? "bg-[var(--ok)]" : "bg-[var(--ink-4)]")} data-live={instance.is_enabled && selected} />
                    </div>
                    
                    <div className="flex items-center justify-between pl-[42px]">
                       <span className={cn(
                         "rounded-full px-2 py-0.5 text-[10px] font-medium",
                         instance.is_enabled
                           ? "bg-[var(--ok-soft)] text-[var(--ok)]"
                           : "bg-[var(--panel-bg-inset)] text-[var(--ink-4)]"
                       )}>
                          {instance.is_enabled ? "Active" : "Paused"}
                       </span>
                       
                       <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                             <button className="rounded-lg p-1 opacity-0 transition-all hover:bg-black/5 group-hover:opacity-100">
                                <MoreHorizontal className="size-3.5 text-[var(--ink-3)]" />
                             </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="ws-bezel-inner min-w-[140px] shadow-xl border-[var(--hairline-strong)]">
                             <DropdownMenuItem className="ws-control text-xs py-2 cursor-pointer focus:bg-[var(--accent-soft)] focus:text-[var(--accent-ink)]">{t("edit")}</DropdownMenuItem>
                             <DropdownMenuItem className="ws-control text-xs py-2 cursor-pointer text-[var(--danger)] focus:bg-[var(--danger-soft)] focus:text-[var(--danger)]">{t("disconnect")}</DropdownMenuItem>
                          </DropdownMenuContent>
                       </DropdownMenu>
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="mx-4 mt-8 rounded-2xl border-2 border-dashed border-[var(--hairline-strong)] p-6 text-center bg-[var(--panel-bg)]/50">
                <p className="ws-caption text-xs leading-relaxed">{t("empty")}</p>
              </div>
            )}
          </div>
        </aside>

        {/* Main Content: Models Manager */}
        <main className="flex-1 overflow-hidden bg-[var(--window-bg)]">
          {selectedInstanceId ? (
            <div className="h-full overflow-y-auto custom-scrollbar">
              <ModelsManager instanceId={selectedInstanceId} />
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center bg-[var(--panel-bg-inset)]/20 p-12 text-center">
               <div className="mb-6 flex size-16 items-center justify-center rounded-3xl border border-[var(--hairline)] bg-[var(--panel-bg-inset)] shadow-sm">
                  <Bot className="size-8 text-[var(--ink-4)]" />
               </div>
               <h3 className="ws-view-title text-[var(--ink-3)] mb-2">Neural Workspace Idle</h3>
               <p className="ws-body text-sm max-w-[280px]">Select a neural channel from the sidebar to manage available brain models.</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
