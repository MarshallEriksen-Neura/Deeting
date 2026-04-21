"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/shadcn/badge"
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
  return (
    <button
      type="button"
      onClick={() => onSelect(agent.id)}
      className={cn(
        "group w-full rounded-xl border p-3.5 text-left",
        "transition-all duration-200 ease-out",
        isSelected
          ? "border-[var(--primary)]/30 bg-[var(--primary)]/8 shadow-[0_0_0_1px_rgba(124,109,255,0.12)]"
          : "border-white/6 bg-white/[0.02] hover:border-white/12 hover:bg-white/[0.04]",
      )}
    >
      {/* Row 1: Name + badges */}
      <div className="flex items-center gap-2">
        <span className="min-w-0 truncate text-[13px] font-medium leading-tight text-[var(--foreground)]">
          {agent.name}
        </span>
        <Badge
          variant="secondary"
          className="shrink-0 rounded-md px-1.5 py-0 text-[10px] font-medium capitalize leading-[18px]"
        >
          {invocationLabel}
        </Badge>
        {agent.preferred_for_image_generation ? (
          <Badge className="shrink-0 rounded-md border-fuchsia-500/20 bg-fuchsia-500/8 px-1.5 py-0 text-[10px] font-medium leading-[18px] text-fuchsia-300">
            {preferredImageLabel}
          </Badge>
        ) : null}
        <div className="ml-auto shrink-0">
          <span
            className={cn(
              "inline-flex rounded-md border px-1.5 py-0 text-[10px] font-medium leading-[18px]",
              agent.is_enabled
                ? "border-emerald-500/20 bg-emerald-500/8 text-emerald-400"
                : "border-white/8 bg-white/4 text-[var(--muted)]",
            )}
          >
            {agent.is_enabled ? enabledLabel : disabledLabel}
          </span>
        </div>
      </div>

      {/* Row 2: Description */}
      <p className="mt-1.5 line-clamp-2 text-[12px] leading-[1.5] text-[var(--muted)]">
        {agent.description?.trim() || "-"}
      </p>

      {/* Row 3: Tags + meta */}
      <div className="mt-2.5 flex items-center gap-1.5">
        <span
          className={cn(
            "inline-flex rounded-md border px-1.5 py-0 text-[10px] font-medium leading-[18px]",
            agent.discoverable
              ? "border-blue-500/20 bg-blue-500/8 text-blue-300"
              : "border-white/8 bg-white/4 text-[var(--muted)]",
          )}
        >
          {agent.discoverable ? discoverableLabel : hiddenLabel}
        </span>
        {agent.tags.slice(0, 3).map((tag) => (
          <span
            key={tag}
            className="inline-flex rounded-md border border-white/6 bg-white/[0.03] px-1.5 py-0 text-[10px] leading-[18px] text-[var(--muted)]"
          >
            {tag}
          </span>
        ))}
        <span className="ml-auto text-[11px] tabular-nums text-[var(--muted)]/60">
          {updatedLabel}
        </span>
      </div>
    </button>
  )
})
