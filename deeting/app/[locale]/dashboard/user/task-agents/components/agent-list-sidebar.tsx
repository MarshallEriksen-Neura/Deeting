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
}

export function AgentListSidebar({
  t,
  selectedAgentId,
  isStarterState,
  agentsLoading,
  filteredAgents,
  onSelectAgent,
}: AgentListSidebarProps) {
  if (agentsLoading) {
    return (
      <div className="space-y-3 px-3 mt-4">
        <Skeleton className="h-16 rounded-xl bg-[var(--panel-bg-inset)]/50" />
        <Skeleton className="h-16 rounded-xl bg-[var(--panel-bg-inset)]/50" />
        <Skeleton className="h-16 rounded-xl bg-[var(--panel-bg-inset)]/50" />
      </div>
    )
  }

  if (!filteredAgents.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-center opacity-30">
        <LayoutGrid className="size-10 mb-4" />
        <p className="ws-caption text-xs leading-relaxed">{t("library.empty")}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5 custom-scrollbar">
        {filteredAgents.map((agent) => {
          const selected = agent.id === selectedAgentId && !isStarterState;
          const kindLabel = agent.kind === "image" ? "VISION" : agent.kind === "voice" ? "AUDIO" : "CORE";
          
          return (
            <button
              key={agent.id}
              onClick={() => onSelectAgent(agent.id)}
              className={cn(
                "ws-rail group relative flex w-full flex-col gap-1 rounded-xl px-4 py-3 text-left transition-all",
                selected ? "bg-[var(--accent-soft)]/50 shadow-[inset_0_0_0_1px_var(--accent-border)]" : "hover:bg-[var(--panel-bg-inset)]/60"
              )}
              data-active={selected}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={cn(
                    "size-8 rounded-lg flex items-center justify-center border transition-all",
                    selected ? "bg-[var(--panel-bg)] border-[var(--accent-border)] shadow-sm" : "bg-[var(--panel-bg-inset)] border-[var(--hairline)]"
                  )}>
                    <BrainCircuit className={cn("size-4", selected ? "text-[var(--accent-strong)]" : "text-[var(--ink-4)]")} />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className={cn(
                      "ws-control truncate text-[13px] font-bold transition-colors",
                      selected ? "text-[var(--ink)]" : "text-[var(--ink-2)]"
                    )}>{agent.name || "Unnamed Agent"}</span>
                    <div className="flex items-center gap-2">
                       <span className="ws-meta text-[8px] tracking-widest opacity-40">{kindLabel}</span>
                       <div className="size-1 rounded-full bg-[var(--hairline-strong)]" />
                       <span className="ws-num text-[9px] opacity-40 truncate">
                          v{agent.version || "1.0"}
                       </span>
                    </div>
                  </div>
                </div>
                <div className={cn("ws-dot", agent.is_enabled ? "bg-[var(--ok)]" : "bg-[var(--ink-4)]")} data-live={agent.is_enabled && selected} />
              </div>
              
              <div className="flex items-center justify-between pl-11 mt-0.5">
                 <div className="flex items-center gap-1.5 opacity-40">
                    <Clock className="size-2.5" />
                    <span className="ws-num text-[9px] font-medium uppercase tracking-tight">
                       {new Date(agent.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </span>
                 </div>
                 
                 <div className="flex items-center gap-1">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                         <button className="opacity-0 group-hover:opacity-100 p-1 hover:bg-black/5 rounded-md transition-all">
                            <MoreHorizontal className="size-3.5 text-[var(--ink-3)]" />
                         </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="ws-bezel-inner min-w-[140px] shadow-xl border-[var(--hairline-strong)]">
                         <DropdownMenuItem className="ws-control text-xs py-2 cursor-pointer focus:bg-[var(--accent-soft)] focus:text-[var(--accent-ink)]">
                            <Copy className="size-3.5 mr-2" />
                            Clone
                         </DropdownMenuItem>
                         <DropdownMenuItem className="ws-control text-xs py-2 cursor-pointer text-[var(--danger)] focus:bg-[var(--danger-soft)] focus:text-[var(--danger)]">
                            <Trash2 className="size-3.5 mr-2" />
                            Delete
                         </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                 </div>
              </div>

              {/* Indicator Rail for Active Agent */}
              {selected && (
                <div className="absolute left-0 top-3 bottom-3 w-1 bg-[var(--accent-strong)] rounded-r-full shadow-[0_0_8px_var(--accent-strong)]" />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
