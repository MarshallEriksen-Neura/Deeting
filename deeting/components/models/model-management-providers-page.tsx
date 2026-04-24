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
      {/* Header */}
      <header className="relative z-30 flex h-[48px] flex-none items-center justify-between border-b border-[var(--hairline)] bg-[var(--panel-bg-inset)]/30 px-5 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="flex size-7 items-center justify-center rounded-lg bg-[var(--accent-strong)] text-white shadow-sm shadow-[var(--accent-soft)]">
            <Layers className="size-4" />
          </div>
          <h1 className="text-[15px] font-semibold tracking-tight text-[var(--ink)]">{t("title")}</h1>
          <div className="h-4 w-px bg-[var(--hairline)]" />
          <div className="flex items-center gap-1.5 rounded-full border border-[var(--hairline)] bg-[var(--window-bg)] px-2.5 py-0.5">
            <div className="size-1.5 rounded-full bg-[var(--ok)]" />
            <span className="font-mono text-[10px] font-semibold tracking-wider text-[var(--ink-2)]">
              {t("workstation.liveNodes", { count: instances.length })}
            </span>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden relative z-20">
        {/* Sidebar: Node Navigator */}
        <aside className="relative flex w-[240px] flex-none flex-col overflow-hidden border-r border-[var(--hairline)] bg-[var(--sidebar-bg)]/30 backdrop-blur-md">
          <div className="flex-none px-5 pb-3 pt-5">
            <p className="ws-meta text-[9px] font-black uppercase tracking-[0.3em] opacity-30">{t("workstation.channelRegistry")}</p>
          </div>

          <div className="flex-1 space-y-1 overflow-y-auto px-3 pb-12 custom-scrollbar">
            {isLoading ? (
              <div className="space-y-3 px-1">
                <Skeleton className="h-16 rounded-[var(--r-14)] bg-[var(--panel-bg-inset)] opacity-40" />
                <Skeleton className="h-16 rounded-[var(--r-14)] bg-[var(--panel-bg-inset)] opacity-40" />
              </div>
            ) : instances.length ? (
              instances.map((instance) => {
                const selected = instance.id === selectedInstanceId;
                const host = instance.base_url.replace(/^https?:\/\//, '').split('/')[0] ?? '';
                return (
                  <div key={instance.id} className="group relative">
                    <button
                      type="button"
                      onClick={() => setSelectedInstanceId(instance.id)}
                      className={cn(
                        "relative flex w-full items-center gap-3 rounded-[var(--r-14)] border px-3 py-2.5 pr-8 text-left transition-all",
                        selected
                          ? "border-[var(--accent-border)] bg-[var(--accent-soft)]/50 shadow-sm"
                          : "border-transparent hover:border-[var(--hairline)] hover:bg-[var(--panel-bg-inset)]/50"
                      )}
                    >
                      {/* Left status rail */}
                      <div
                        className={cn(
                          "absolute left-0 top-1/2 h-[14px] w-[2.5px] -translate-y-1/2 rounded-r-full",
                          instance.is_enabled
                            ? "bg-[var(--ok)] shadow-[0_0_0_1px_color-mix(in_oklch,var(--ok)_18%,transparent)]"
                            : "bg-[var(--ink-4)]"
                        )}
                      />

                      <div className={cn(
                        "flex size-8 flex-none items-center justify-center rounded-xl border transition-all",
                        selected
                          ? "border-[var(--accent-border)] bg-[var(--panel-bg)]"
                          : "border-[var(--hairline)] bg-[var(--panel-bg-inset)] opacity-70"
                      )}>
                        <ProviderIcon
                          src={instance.icon}
                          className="size-4 flex-none"
                          fallback={<Server className={cn("size-3.5 flex-none", selected ? "text-[var(--accent-strong)]" : "text-[var(--ink-4)]")} />}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <span className={cn(
                          "block truncate text-[13px] leading-tight transition-colors",
                          selected ? "font-semibold text-[var(--ink)]" : "font-medium text-[var(--ink-2)]"
                        )}>
                          {instance.name}
                        </span>
                        <span className="mt-0.5 block truncate font-mono text-[9px] text-[var(--ink-4)] opacity-50 tracking-wider">
                          {host}
                        </span>
                      </div>

                      <div className={cn(
                        "size-1.5 rounded-full",
                        instance.is_enabled ? "bg-[var(--ok)]" : "bg-[var(--ink-4)]"
                      )} />
                    </button>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label={`${instance.name} actions`}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => event.stopPropagation()}
                          className="absolute right-2 top-1/2 z-20 -translate-y-1/2 rounded-lg p-1.5 opacity-0 transition-all hover:bg-[var(--panel-bg)] group-hover:opacity-100 data-[state=open]:opacity-100 data-[state=open]:bg-[var(--panel-bg)]"
                        >
                          <MoreHorizontal className="size-3.5 text-[var(--ink-3)]" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        className="ws-bezel-inner min-w-[160px] border-[var(--hairline-strong)] p-1"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <DropdownMenuItem className="ws-control cursor-pointer rounded-lg px-3 py-2 text-[12px] font-semibold tracking-tight transition-colors focus:bg-[var(--accent-soft)] focus:text-[var(--accent-ink)]">{t("edit")}</DropdownMenuItem>
                        <DropdownMenuItem className="ws-control cursor-pointer rounded-lg px-3 py-2 text-[12px] font-semibold tracking-tight text-[var(--danger)] transition-colors focus:bg-[var(--danger-soft)] focus:text-[var(--danger)]">{t("disconnect")}</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                );
              })
            ) : (
              <div className="mx-1 mt-8 rounded-[var(--r-14)] border border-dashed border-[var(--hairline-strong)] p-8 text-center">
                <Bot className="mx-auto mb-3 size-8 text-[var(--ink-4)] opacity-10" />
                <p className="ws-caption text-xs font-semibold uppercase tracking-widest opacity-40">{t("empty")}</p>
              </div>
            )}
          </div>
        </aside>

        {/* Main Workspace */}
        <main className="relative flex-1 overflow-hidden bg-[var(--window-bg)]">
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
