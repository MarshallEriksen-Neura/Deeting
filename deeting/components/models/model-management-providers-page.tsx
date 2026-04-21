"use client";

import * as React from "react";
import { Bot, Server, Plus, MoreHorizontal, Activity, Layers } from "lucide-react";
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
      <header className="flex h-[56px] flex-none items-center justify-between px-6 border-b border-[var(--hairline)] bg-[var(--window-bg)]">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent-strong)]">
              <Layers className="size-4.5" />
            </div>
            <h1 className="ws-view-title">{t("title")}</h1>
          </div>
          <div className="h-4 w-px bg-[var(--hairline-strong)]" />
          <div className="flex items-center gap-2">
             <Badge variant="secondary" className="ws-num text-[10px] px-2 py-0 h-5 bg-[var(--panel-bg-inset)] border-[var(--hairline)] text-[var(--ink-3)] font-medium">
                {instances.length} CHANNELS
             </Badge>
          </div>
        </div>
        
       
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar: Neural Channel Navigator */}
        <aside className="w-[280px] flex-none border-r border-[var(--hairline)] bg-[var(--panel-bg-inset)]/30 flex flex-col overflow-hidden">
          <div className="flex-none px-5 py-4">
            <p className="ws-meta">{t("localTag")}</p>
          </div>
          
          <div className="flex-1 overflow-y-auto px-2 pb-6 space-y-0.5 custom-scrollbar">
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
                      "ws-rail group relative flex w-full flex-col gap-1 rounded-xl px-4 py-3 text-left transition-all",
                      selected ? "bg-[var(--accent-soft)]/50" : "hover:bg-[var(--hairline-subtle)]"
                    )}
                    data-active={selected}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className={cn(
                          "size-7 rounded-lg flex items-center justify-center border transition-colors",
                          selected ? "bg-[var(--panel-bg)] border-[var(--accent-border)] shadow-sm" : "bg-[var(--panel-bg-inset)] border-[var(--hairline)]"
                        )}>
                          {instance.icon ? (
                             <img src={instance.icon} className="size-4 flex-none opacity-90" alt="" />
                          ) : (
                             <Server className={cn("size-3.5 flex-none", selected ? "text-[var(--accent-strong)]" : "text-[var(--ink-3)]")} />
                          )}
                        </div>
                        <span className={cn(
                          "ws-control truncate text-[13px] transition-colors",
                          selected ? "text-[var(--ink)] font-bold" : "text-[var(--ink-2)]"
                        )}>{instance.name}</span>
                      </div>
                      <div className={cn("ws-dot", instance.is_enabled ? "bg-[var(--ok)]" : "bg-[var(--ink-4)]")} data-live={instance.is_enabled && selected} />
                    </div>
                    
                    <div className="flex items-center justify-between pl-[38px]">
                       <span className="ws-num text-[10px] text-[var(--ink-4)] truncate opacity-70">
                          {instance.base_url.replace(/^https?:\/\//, '').split('/')[0]}
                       </span>
                       
                       <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                             <button className="opacity-0 group-hover:opacity-100 p-1 hover:bg-black/5 rounded-md transition-all">
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
        <main className="flex-1 overflow-hidden bg-[var(--panel-bg)]">
          {selectedInstanceId ? (
            <div className="h-full overflow-y-auto custom-scrollbar">
              <ModelsManager instanceId={selectedInstanceId} />
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center p-12 text-center bg-[var(--panel-bg-inset)]/10">
               <div className="size-16 rounded-3xl bg-[var(--panel-bg-inset)] border border-[var(--hairline)] flex items-center justify-center mb-6 shadow-sm">
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
