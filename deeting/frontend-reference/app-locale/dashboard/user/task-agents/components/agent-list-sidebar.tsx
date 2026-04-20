"use client"

import { Bot, Search } from "lucide-react"
import { Input } from "@/ui/shadcn/input"
import { ScrollArea } from "@/ui/shadcn/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/shadcn/select"
import { Skeleton } from "@/ui/shadcn/skeleton"
import {
  GlassCard,
  GlassCardContent,
  GlassCardDescription,
  GlassCardHeader,
  GlassCardTitle,
} from "@/ui/common/glass-card"
import type { CustomTaskAgentProfile } from "@/lib/api/custom-task-agents"
import { AgentListItem } from "./agent-list-item"
import { NEW_AGENT_ID } from "./task-agents-helpers"

type Translation = (key: string, values?: Record<string, string | number>) => string

type GroupedAgents = {
  chat: CustomTaskAgentProfile[]
  image: CustomTaskAgentProfile[]
  voice: CustomTaskAgentProfile[]
}

type AgentListSidebarProps = {
  t: Translation
  searchQuery: string
  kindFilter: string
  statusFilter: string
  selectedAgentId: string | null
  isStarterState: boolean
  agentsLoading: boolean
  agentsError: Error | undefined
  filteredAgents: CustomTaskAgentProfile[]
  groupedAgents: GroupedAgents
  dateFormatter: Intl.DateTimeFormat
  onSearchChange: (value: string) => void
  onKindFilterChange: (value: string) => void
  onStatusFilterChange: (value: string) => void
  onSelectAgent: (agentId: string) => void
}

export function AgentListSidebar({
  t,
  searchQuery,
  kindFilter,
  statusFilter,
  selectedAgentId,
  isStarterState,
  agentsLoading,
  agentsError,
  filteredAgents,
  groupedAgents,
  dateFormatter,
  onSearchChange,
  onKindFilterChange,
  onStatusFilterChange,
  onSelectAgent,
}: AgentListSidebarProps) {
  return (
    <GlassCard hover="none" className="overflow-hidden border-white/6">
      <GlassCardHeader className="space-y-3.5 pb-0">
        <div className="space-y-0.5">
          <GlassCardTitle className="text-[15px] font-semibold">
            {t("library.title")}
          </GlassCardTitle>
          <GlassCardDescription className="text-[12px]">
            {t("library.description")}
          </GlassCardDescription>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--muted)]/50" />
          <Input
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={t("library.searchPlaceholder")}
            className="h-8 rounded-lg border-white/8 bg-white/[0.03] pl-8 text-[13px] placeholder:text-[var(--muted)]/40"
          />
        </div>

        {/* Filters */}
        <div className="grid grid-cols-2 gap-2">
          <Select value={kindFilter} onValueChange={onKindFilterChange}>
            <SelectTrigger className="h-7 rounded-lg border-white/8 bg-white/[0.03] text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("filters.allKinds")}</SelectItem>
              <SelectItem value="chat">{t("badges.chat")}</SelectItem>
              <SelectItem value="image_generation">{t("badges.imageGeneration")}</SelectItem>
              <SelectItem value="text_to_speech">{t("badges.textToSpeech")}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={onStatusFilterChange}>
            <SelectTrigger className="h-7 rounded-lg border-white/8 bg-white/[0.03] text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("filters.allStatuses")}</SelectItem>
              <SelectItem value="enabled">{t("badges.enabled")}</SelectItem>
              <SelectItem value="disabled">{t("badges.disabled")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </GlassCardHeader>

      <GlassCardContent className="pt-3">
        <ScrollArea className="h-[680px] pr-3">
          <div className="space-y-2">
            {/* New agent draft indicator */}
            {selectedAgentId === NEW_AGENT_ID ? (
              <div className="rounded-xl border border-dashed border-[var(--primary)]/25 bg-[var(--primary)]/6 p-3">
                <p className="text-[13px] font-medium text-[var(--foreground)]">
                  {isStarterState ? t("starter.title") : t("library.draftTitle")}
                </p>
                <p className="mt-0.5 text-[12px] text-[var(--muted)]">
                  {isStarterState ? t("starter.description") : t("library.draftDescription")}
                </p>
              </div>
            ) : null}

            {/* Loading */}
            {agentsLoading ? (
              Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={`skeleton-${index}`}
                  className="space-y-2.5 rounded-xl border border-white/6 p-3.5"
                >
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3.5 w-full" />
                  <Skeleton className="h-3 w-5/6" />
                </div>
              ))
            ) : filteredAgents.length === 0 ? (
              /* Empty */
              <div className="rounded-xl border border-dashed border-white/8 p-8 text-center">
                <Bot className="mx-auto size-8 text-[var(--muted)]/40" />
                <p className="mt-3 text-[13px] font-medium text-[var(--foreground)]">
                  {t("library.emptyTitle")}
                </p>
                <p className="mt-1 text-[12px] text-[var(--muted)]">
                  {agentsError ? agentsError.message : t("library.emptyDescription")}
                </p>
              </div>
            ) : (
              /* Grouped agent list */
              <>
                <AgentGroup
                  agents={groupedAgents.chat}
                  label={t("library.sections.chat")}
                  selectedAgentId={selectedAgentId}
                  dateFormatter={dateFormatter}
                  invocationLabel={t("badges.chat")}
                  t={t}
                  onSelect={onSelectAgent}
                />
                <AgentGroup
                  agents={groupedAgents.image}
                  label={t("library.sections.image")}
                  selectedAgentId={selectedAgentId}
                  dateFormatter={dateFormatter}
                  invocationLabel={t("badges.imageGeneration")}
                  t={t}
                  onSelect={onSelectAgent}
                />
                <AgentGroup
                  agents={groupedAgents.voice}
                  label={t("library.sections.voice")}
                  selectedAgentId={selectedAgentId}
                  dateFormatter={dateFormatter}
                  invocationLabel={t("badges.textToSpeech")}
                  t={t}
                  onSelect={onSelectAgent}
                />
              </>
            )}
          </div>
        </ScrollArea>
      </GlassCardContent>
    </GlassCard>
  )
}

function AgentGroup({
  agents,
  label,
  selectedAgentId,
  dateFormatter,
  invocationLabel,
  t,
  onSelect,
}: {
  agents: CustomTaskAgentProfile[]
  label: string
  selectedAgentId: string | null
  dateFormatter: Intl.DateTimeFormat
  invocationLabel: string
  t: Translation
  onSelect: (agentId: string) => void
}) {
  if (agents.length === 0) return null

  return (
    <div className="space-y-1.5">
      <p className="px-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]/50">
        {label}
      </p>
      {agents.map((agent) => (
        <AgentListItem
          key={agent.id}
          agent={agent}
          isSelected={selectedAgentId === agent.id}
          updatedLabel={t("library.updatedAt", {
            value: dateFormatter.format(new Date(agent.updated_at)),
          })}
          invocationLabel={invocationLabel}
          preferredImageLabel={t("badges.imagePreferred")}
          enabledLabel={t("badges.enabled")}
          disabledLabel={t("badges.disabled")}
          discoverableLabel={t("badges.discoverable")}
          hiddenLabel={t("badges.hidden")}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}
