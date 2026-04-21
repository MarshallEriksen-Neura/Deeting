"use client"

import * as React from "react"
import { Bot, MessageSquare, Image, Mic } from "lucide-react"
import { cn } from "@/lib/utils"
import type { CustomTaskAgentProfile } from "@/lib/api/custom-task-agents"

type AgentListItemProps = {
  agent: CustomTaskAgentProfile
  isSelected: boolean
  updatedLabel: string
  invocationLabel: string
  preferredImageLabel: string
  enabledLabel: string
  disabledLabel: string
  discoverableLabel: string
  hiddenLabel: string
  onSelect: (agentId: string) => void
}

const KIND_ICONS: Record<string, any> = {
  chat: MessageSquare,
  image_generation: Image,
  text_to_speech: Mic,
}

export const AgentListItem = React.memo(function AgentListItem({
  agent,
  isSelected,
  updatedLabel,
  invocationLabel,
  preferredImageLabel,
  enabledLabel,
  disabledLabel,
  discoverableLabel,
  hiddenLabel,
  onSelect,
}: AgentListItemProps) {
  const Icon = KIND_ICONS[agent.invocation_kind] || Bot;
  
  return (
    <button
      type="button"
      onClick={() => onSelect(agent.id)}
      className={cn(
        "ws-rail group relative flex w-full flex-col gap-1 rounded-lg px-3 py-2.5 text-left transition-colors",
        isSelected ? "ws-row-active shadow-sm" : "hover:bg-[var(--hairline-subtle)]"
      )}
      data-active={isSelected}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className={cn("size-3.5 flex-none", isSelected ? "text-[var(--accent-strong)]" : "text-[var(--ink-3)]")} />
          <span className="ws-control truncate font-semibold text-xs">{agent.name}</span>
        </div>
        <div className={cn("ws-dot flex-none", agent.is_enabled ? "bg-[var(--ok)]" : "bg-[var(--ink-4)]")} data-live={agent.is_enabled} />
      </div>
      
      <p className="ws-caption line-clamp-1 text-[10px] opacity-60 pl-5">
        {agent.description || "No description provided"}
      </p>

      <div className="flex items-center justify-between mt-1 pl-5">
         <div className="flex items-center gap-1.5 overflow-hidden">
            {agent.tags.slice(0, 2).map(tag => (
               <span key={tag} className="ws-meta text-[9px] px-1 bg-[var(--panel-bg-inset)] rounded border border-[var(--hairline)]">
                  {tag}
               </span>
            ))}
            {agent.tags.length > 2 && <span className="text-[9px] opacity-40">+{agent.tags.length - 2}</span>}
         </div>
         <span className="ws-num text-[9px] opacity-30 tabular-nums">{updatedLabel.split(':').pop()?.trim()}</span>
      </div>
    </button>
  )
})
