"use client"

import * as React from "react"
import { Search, Plus, Filter, LayoutGrid, BrainCircuit, Activity, Clock, Trash2, Copy, MoreHorizontal } from "lucide-react"
import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/shadcn/skeleton"
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from "@/components/ui/shadcn/dropdown-menu"

interface AgentListSidebarProps {
  t: any
  searchQuery: string
  kindFilter: string
  statusFilter: string
  selectedAgentId: string | null
  isStarterState: boolean
  agentsLoading: boolean
  agentsError: any
  filteredAgents: any[]
  groupedAgents: Record<string, any[]>
  dateFormatter: Intl.DateTimeFormat
  onSearchChange: (q: string) => void
  onKindFilterChange: (k: string) => void
  onStatusFilterChange: (s: string) => void
  onSelectAgent: (id: string) => void
  setDeleteDialogOpen: (open: boolean) => void
}

export function AgentListSidebar({
  t,
  selectedAgentId,
  isStarterState,
  agentsLoading,
  filteredAgents,
  onSelectAgent,
  setDeleteDialogOpen,
}: AgentListSidebarProps) {
  if (agentsLoading) {
    return (
      <div className="space-y-3 px-3 mt-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="py-6 border-b border-[var(--hairline-subtle)] space-y-3 opacity-20">
             <div className="h-2 w-12 bg-[var(--ink-4)]" />
             <div className="h-6 w-48 bg-[var(--ink-4)]" />
             <div className="h-2 w-32 bg-[var(--ink-4)]" />
          </div>
        ))}
      </div>
    )
  }

  if (!filteredAgents.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-center opacity-30">
        <LayoutGrid className="size-10 mb-4" />
        <p className="ws-caption text-xs leading-relaxed">{t("library.noResults")}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto py-2 space-y-0 custom-scrollbar mask-linear-b">
        {filteredAgents.map((agent) => {
          const selected = agent.id === selectedAgentId && !isStarterState;
          const kindLabel =
            agent.kind === "image"
              ? t("library.kindLabels.image")
              : agent.kind === "voice"
                ? t("library.kindLabels.voice")
                : t("library.kindLabels.chat")
          
          return (
            <div
              key={agent.id}
              className={cn(
                "group relative border-b border-[var(--hairline-subtle)] py-6 pr-4 transition-all duration-300",
                selected ? "bg-[var(--accent-soft)]/20" : "hover:bg-[var(--panel-bg-inset)]/20"
              )}
            >
              <div className="flex items-start justify-between gap-4 px-2">
                <button
                  type="button"
                  onClick={() => onSelectAgent(agent.id)}
                  className="flex min-w-0 flex-1 flex-col text-left"
                >
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={cn(
                      "font-mono text-[8px] tracking-[0.25em] transition-opacity duration-500",
                      selected ? "text-[var(--accent-strong)] opacity-100" : "text-[var(--ink-4)] opacity-40 group-hover:opacity-80"
                    )}>
                      {kindLabel}
                    </span>
                    {agent.is_enabled && (
                      <div className="size-[3px] rounded-full bg-[var(--ok)] animate-pulse" />
                    )}
                  </div>
                  
                  <h3 className={cn(
                    "text-xl font-bold tracking-tight transition-all duration-300 truncate",
                    selected ? "text-[var(--ink)] translate-x-1" : "text-[var(--ink-3)] group-hover:text-[var(--ink)]"
                  )}>
                    {agent.name || t("library.unnamed")}
                  </h3>
                </div>

                <div className="flex items-center gap-4 mt-2 opacity-30 group-hover:opacity-60 transition-opacity">
                  <span className="font-mono text-[8px] tracking-widest text-[var(--ink-4)]">
                    {t("library.modifiedShort", {
                      value: new Date(agent.updated_at).toLocaleDateString(undefined, {
                        month: "2-digit",
                        day: "2-digit",
                        year: "numeric",
                      }),
                    })}
                  </span>
                  <div className="h-px flex-1 bg-[var(--hairline-strong)]" />
                </div>
                </button>

                <div className="flex flex-col items-end gap-1 flex-none pt-1">
                   <span className="font-mono text-[10px] text-[var(--ink-4)] tabular-nums group-hover:text-[var(--ink-3)] transition-colors">
                      v{agent.version || "1.0"}
                   </span>
                   <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                         <button className="opacity-0 group-hover:opacity-60 hover:opacity-100 p-1 transition-all">
                            <MoreHorizontal className="size-3 text-[var(--ink-3)]" />
                         </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="ws-bezel-inner min-w-[140px] shadow-2xl border-[var(--hairline-strong)] bg-[var(--window-bg)]">
                         <DropdownMenuItem 
                           className="text-[10px] font-bold tracking-widest uppercase py-2.5 cursor-pointer text-[var(--danger)] focus:bg-[var(--danger-soft)] focus:text-[var(--danger)] transition-colors"
                           onClick={(e) => {
                             e.stopPropagation();
                             onSelectAgent(agent.id);
                             setDeleteDialogOpen(true);
                           }}
                         >
                            <Trash2 className="size-3 mr-3" />
                            {t("actions.delete")}
                         </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                </div>
              </div>

              {/* Selection Mark */}
              {selected && (
                <div className="absolute left-[-2px] top-1/2 -translate-y-1/2 w-1 h-8 bg-[var(--accent-strong)] animate-in slide-in-from-left-2 duration-500" />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
