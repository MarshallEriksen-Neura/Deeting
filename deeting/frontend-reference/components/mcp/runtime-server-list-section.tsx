"use client"

import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, ChevronRight, Folder, Pencil, RefreshCw, Search, Server, Sparkles, Terminal } from "lucide-react"
import { useTranslations } from "next-intl"

import { Badge } from "@/ui/shadcn/badge"
import { GlassButton } from "@/ui/common/glass-button"
import { GlassCard } from "@/ui/common/glass-card"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/ui/shadcn/tooltip"
import { cn } from "@/lib/utils"
import type { MCPTool } from "@/types/mcp"

import { ServerCard } from "./server-card"
import type { MCPRuntimeServerGroup } from "./registry-view-model"
import { isMcpIndexMissing } from "./tool-semantics"

interface RuntimeServerListSectionProps {
  groups: MCPRuntimeServerGroup[]
  conflictCount: number
  platform?: "desktop" | "cloud"
  toggleMode?: "runtime" | "desired"
  onToggleTool?: (tool: MCPTool, enabled: boolean) => void
  onPrimaryAction?: (tool: MCPTool) => void
  onResolveConflict?: (tool: MCPTool) => void
  onEditServer?: (tool: MCPTool) => void
  onDeleteServer?: (tool: MCPTool) => void
  onSyncAll?: () => void
  syncAllLoading?: boolean
  onSyncTool?: (tool: MCPTool) => void
  syncingToolIds?: Record<string, boolean>
  onReindexMissingTools?: (tools: MCPTool[]) => void
  reindexMissingLoading?: boolean
}

type GroupTone = {
  bar: string
  icon: string
  iconText: string
  badge: string
  metric: string
  progress: string
  glow: string
}

const GROUP_TONES: Record<"healthy" | "partial" | "attention" | "idle", GroupTone> = {
  healthy: {
    bar: "from-emerald-400 via-teal-400 to-cyan-400",
    icon: "border-emerald-200/80 bg-gradient-to-br from-emerald-50 to-teal-50",
    iconText: "text-emerald-600",
    badge: "bg-emerald-100 text-emerald-700 hover:bg-emerald-100",
    metric: "border-emerald-200/70 bg-emerald-50/80 text-emerald-700",
    progress: "from-emerald-400 via-emerald-500 to-teal-500",
    glow: "bg-emerald-400/10",
  },
  partial: {
    bar: "from-sky-400 via-blue-400 to-cyan-400",
    icon: "border-sky-200/80 bg-gradient-to-br from-sky-50 to-cyan-50",
    iconText: "text-sky-600",
    badge: "bg-sky-100 text-sky-700 hover:bg-sky-100",
    metric: "border-sky-200/70 bg-sky-50/80 text-sky-700",
    progress: "from-sky-400 via-blue-500 to-cyan-500",
    glow: "bg-sky-400/10",
  },
  attention: {
    bar: "from-amber-300 via-orange-400 to-rose-400",
    icon: "border-amber-200/80 bg-gradient-to-br from-amber-50 to-orange-50",
    iconText: "text-amber-600",
    badge: "bg-amber-100 text-amber-700 hover:bg-amber-100",
    metric: "border-amber-200/70 bg-amber-50/80 text-amber-700",
    progress: "from-amber-300 via-orange-400 to-rose-400",
    glow: "bg-amber-400/10",
  },
  idle: {
    bar: "from-slate-200 via-slate-300 to-slate-400",
    icon: "border-slate-200/80 bg-gradient-to-br from-slate-50 to-slate-100",
    iconText: "text-slate-500",
    badge: "bg-slate-100 text-slate-600 hover:bg-slate-100",
    metric: "border-slate-200/70 bg-slate-50/80 text-slate-600",
    progress: "from-slate-300 via-slate-400 to-slate-500",
    glow: "bg-slate-400/10",
  },
}

const getGroupToneKey = (group: MCPRuntimeServerGroup): keyof typeof GROUP_TONES => {
  if (group.conflictCount > 0) return "attention"
  if (group.runningCount === 0) return "idle"
  if (group.runningCount === group.toolCount) return "healthy"
  return "partial"
}

const getSourceLabel = (group: MCPRuntimeServerGroup) => {
  if (group.server?.server_type === "streamable-http") return "Streamable HTTP"
  if (group.server?.server_type === "stdio") return "Stdio"
  if (group.server?.server_type === "sse") return "SSE"
  if (group.source?.type === "modelscope") return "ModelScope"
  if (group.source?.type === "github") return "GitHub"
  if (group.source?.type === "cloud") return "Cloud"
  if (group.source?.type === "url") return "Remote"
  if (group.source?.type === "local") return "Local"
  if (group.sourceType === "url") return "Remote"
  if (group.sourceType === "local") return "Local"
  return group.sourceType
}

export function RuntimeServerListSection({
  groups,
  conflictCount,
  platform = "cloud",
  toggleMode = "runtime",
  onToggleTool,
  onPrimaryAction,
  onResolveConflict,
  onEditServer,
  onDeleteServer,
  onSyncAll,
  syncAllLoading = false,
  onSyncTool,
  syncingToolIds,
  onReindexMissingTools,
  reindexMissingLoading = false,
}: RuntimeServerListSectionProps) {
  const t = useTranslations("mcp")
  const [activeTab, setActiveTab] = useState("all")
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)

  const filteredGroups = useMemo(() => {
    return groups.filter((group) => {
      if (activeTab === "all") return true
      if (activeTab === "running") return group.runningCount > 0
      if (activeTab === "stopped") return group.runningCount === 0
      if (activeTab === "conflicts") return group.conflictCount > 0
      return true
    })
  }, [activeTab, groups])

  const runningCount = groups.filter((group) => group.runningCount > 0).length
  const selectedGroup = useMemo(
    () => groups.find((group) => group.id === selectedGroupId) ?? null,
    [groups, selectedGroupId]
  )

  useEffect(() => {
    if (selectedGroupId && !groups.some((group) => group.id === selectedGroupId)) {
      setSelectedGroupId(null)
    }
  }, [groups, selectedGroupId])

  if (selectedGroup) {
    const toneKey = getGroupToneKey(selectedGroup)
    const tone = GROUP_TONES[toneKey]
    const sourceLabel = getSourceLabel(selectedGroup)
    const representativeTool = selectedGroup.tools[0]
    const syncKey = representativeTool?.sourceId ?? representativeTool?.id
    const groupSyncLoading = Boolean(syncKey && syncingToolIds?.[syncKey])
    const canSyncGroup = platform === "cloud" && Boolean(representativeTool && onSyncTool)
    const canEditGroup = platform === "cloud" && Boolean(representativeTool && onEditServer)
    const canReviewGroup = Boolean(selectedGroup.conflictCount > 0 && representativeTool && onResolveConflict)
    const missingIndexTools = selectedGroup.tools.filter((tool) => isMcpIndexMissing(tool))
    const canReindexMissing =
      platform === "desktop" && missingIndexTools.length > 0 && Boolean(onReindexMissingTools)

    return (
      <section className="space-y-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="mcp-runtime-toolbar-cluster flex items-center gap-2 rounded-[1.35rem] border border-white/55 bg-white/70 p-2 shadow-[0_18px_36px_-28px_rgba(15,23,42,0.28)] backdrop-blur-xl">
            <GlassButton
              size="sm"
              variant="secondary"
              className="mcp-runtime-toolbar-button h-9 rounded-xl border-white/70 bg-white/84 px-3.5 text-[12px] text-slate-700 shadow-[0_12px_28px_-20px_rgba(15,23,42,0.35)] hover:bg-white"
              onClick={() => setSelectedGroupId(null)}
            >
              <ArrowLeft size={14} />
              {t("runtime.workspace.back")}
            </GlassButton>
            <GlassButton
              size="sm"
              variant="ghost"
              className="mcp-runtime-toolbar-pill h-9 rounded-xl border border-white/70 bg-white/82 px-3.5 text-[12px] text-slate-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_10px_24px_-20px_rgba(15,23,42,0.25)] hover:bg-white/82"
            >
              {t("runtime.workspace.summary", {
                name: selectedGroup.name,
                count: selectedGroup.toolCount,
              })}
            </GlassButton>
          </div>

          <div className="mcp-runtime-action-cluster flex items-center gap-2 rounded-[1.15rem] border border-white/55 bg-white/70 p-2 shadow-[0_18px_32px_-26px_rgba(15,23,42,0.28)] backdrop-blur-xl">
            {canReindexMissing && (
              <GlassButton
                size="sm"
                variant="secondary"
                className="mcp-runtime-action-button h-8 rounded-xl px-3 text-[11px]"
                loading={reindexMissingLoading}
                onClick={() => onReindexMissingTools?.(missingIndexTools)}
              >
                <Sparkles size={13} />
                {reindexMissingLoading ? t("actions.reindexingMissing") : t("actions.reindexMissing")}
              </GlassButton>
            )}
            {canReviewGroup && (
              <GlassButton
                size="sm"
                variant="secondary"
                className="mcp-runtime-action-button h-8 rounded-xl px-3 text-[11px]"
                onClick={() => onResolveConflict?.(representativeTool)}
              >
                <Search size={13} />
                {t("runtime.server.review")}
              </GlassButton>
            )}
            {canSyncGroup && (
              <GlassButton
                size="icon-sm"
                variant="secondary"
                className="mcp-runtime-action-button text-slate-500 hover:text-slate-900"
                loading={groupSyncLoading}
                onClick={() => onSyncTool?.(representativeTool)}
              >
                <RefreshCw size={14} className={groupSyncLoading ? "animate-spin" : ""} />
              </GlassButton>
            )}
            {canEditGroup && (
              <GlassButton
                size="icon-sm"
                variant="secondary"
                className="mcp-runtime-action-button text-slate-500 hover:text-slate-900"
                onClick={() => onEditServer?.(representativeTool)}
              >
                <Pencil size={14} />
              </GlassButton>
            )}
          </div>
        </div>

        <GlassCard
          blur="lg"
          theme="default"
          hover="none"
          padding="none"
          className="overflow-hidden border-white/35 shadow-[0_22px_60px_-34px_rgba(15,23,42,0.32)]"
        >
          <div className="relative overflow-hidden px-5 py-5 sm:px-6">
            <div className={cn("pointer-events-none absolute -top-16 right-0 h-40 w-40 rounded-full blur-3xl", tone.glow)} />
            <div className={cn("absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r", tone.bar)} />

            <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-w-0 items-start gap-4">
                <div className={cn("flex size-12 shrink-0 items-center justify-center rounded-2xl border shadow-sm", tone.icon)}>
                  <Folder size={18} className={tone.iconText} />
                </div>
                <div className="min-w-0 space-y-3">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-slate-400">
                    <span>MCP</span>
                    <span className="h-1 w-1 rounded-full bg-slate-300" />
                    <span>{sourceLabel}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-xl font-semibold text-[var(--foreground)]">{selectedGroup.name}</h3>
                    <Badge className={tone.badge}>{selectedGroup.runningCount > 0 ? t("runtime.server.running") : t("tool.status.stopped")}</Badge>
                    {selectedGroup.conflictCount > 0 && (
                      <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                        {selectedGroup.conflictCount} {t("runtime.server.conflicts")}
                      </Badge>
                    )}
                  </div>
                  <p className="max-w-3xl text-sm leading-relaxed text-[var(--muted)]">
                    {selectedGroup.description || t("runtime.server.noDescription")}
                  </p>
                  <div className="flex flex-wrap gap-2 text-xs text-slate-600">
                    <span className="rounded-full bg-slate-100 px-2.5 py-1">
                      {t("runtime.server.source")}: {sourceLabel}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1">
                      {selectedGroup.toolCount} {t("runtime.server.toolCount")}
                    </span>
                    {selectedGroup.source?.pathOrUrl && (
                      <span className="max-w-[min(48rem,70vw)] truncate rounded-full bg-slate-100 px-2.5 py-1 font-mono text-[11px]">
                        {selectedGroup.source.pathOrUrl}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className={cn("rounded-[1.4rem] border px-4 py-3 shadow-sm", tone.metric)}>
                <div className="text-[10px] uppercase tracking-[0.22em] opacity-70">
                  {t("runtime.server.running")}
                </div>
                <div className="mt-1 text-right text-2xl font-semibold">
                  {selectedGroup.runningCount}
                  <span className="ml-1 text-base font-medium opacity-60">/ {selectedGroup.toolCount}</span>
                </div>
              </div>
            </div>
          </div>
        </GlassCard>

        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">
                {t("runtime.workspace.tools")}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                {t("runtime.workspace.subtitle", { count: selectedGroup.toolCount })}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3">
            {selectedGroup.tools.map((tool) => (
              <ServerCard
                key={tool.id}
                tool={tool}
                platform={platform}
                toggleMode={toggleMode}
                density="compact"
                onToggle={onToggleTool ? (item, enabled) => onToggleTool(item, enabled) : undefined}
                onPrimaryAction={onPrimaryAction ? () => onPrimaryAction(tool) : undefined}
                onResolveConflict={onResolveConflict ? () => onResolveConflict(tool) : undefined}
                onSync={onSyncTool ? () => onSyncTool(tool) : undefined}
                syncLoading={Boolean(syncingToolIds?.[tool.sourceId ?? tool.id])}
                onEdit={onEditServer ? () => onEditServer(representativeTool ?? tool) : undefined}
                onDelete={onDeleteServer ? () => onDeleteServer(platform === "cloud" ? representativeTool ?? tool : tool) : undefined}
              />
            ))}
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="space-y-4">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex w-full items-center gap-2">
          <h2 className="whitespace-nowrap text-sm font-bold uppercase tracking-wider text-gray-900">{t("runtime.title")}</h2>
          <div className="mx-4 h-px flex-1 bg-gray-100" />
        </div>
      </div>

      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="mcp-runtime-toolbar flex flex-wrap items-center gap-2 rounded-[1.4rem] border border-white/55 bg-white/72 p-2 shadow-[0_18px_40px_-28px_rgba(15,23,42,0.32)] backdrop-blur-xl">
          <div className="mcp-runtime-toolbar-segment flex flex-wrap items-center gap-2 rounded-[1.1rem]">
            {[
              { value: "all", label: t("runtime.tabs.all"), count: null, tone: "slate" },
              { value: "running", label: t("runtime.tabs.running"), count: runningCount, tone: "emerald" },
              { value: "stopped", label: t("runtime.tabs.stopped"), count: null, tone: "slate" },
              { value: "conflicts", label: t("runtime.tabs.conflicts"), count: conflictCount, tone: "amber" },
            ].map((item) => {
              const isActive = activeTab === item.value
              return (
                <GlassButton
                  key={item.value}
                  size="sm"
                  variant={isActive ? "secondary" : "ghost"}
                  aria-pressed={isActive}
                  data-active={isActive ? "true" : "false"}
                  className={cn(
                    "mcp-runtime-toolbar-button h-9 rounded-xl px-3.5 text-[12px] font-medium transition-all",
                    isActive
                      ? "border-white/80 bg-white/92 text-slate-900 shadow-[0_10px_24px_-18px_rgba(15,23,42,0.45)]"
                      : "text-slate-600 hover:bg-white/70 hover:text-slate-900",
                    item.tone === "emerald" && isActive && "text-emerald-700",
                    item.tone === "amber" && isActive && "text-amber-700"
                  )}
                  onClick={() => setActiveTab(item.value)}
                >
                  {item.label}
                  {typeof item.count === "number" && item.count > 0 && (
                    <span
                      className={cn(
                        "min-w-[18px] rounded-full px-1.5 py-0.5 text-center text-[10px] font-semibold",
                        item.tone === "emerald"
                          ? isActive
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-emerald-50 text-emerald-600"
                          : item.tone === "amber"
                            ? isActive
                              ? "bg-amber-100 text-amber-700"
                              : "bg-amber-50 text-amber-600"
                            : "bg-slate-100 text-slate-600"
                      )}
                    >
                      {item.count}
                    </span>
                  )}
                </GlassButton>
              )
            })}
          </div>
        </div>

        <div className="mcp-runtime-toolbar-cluster flex items-center justify-between gap-2 rounded-[1.35rem] border border-white/55 bg-white/70 p-2 shadow-[0_18px_36px_-28px_rgba(15,23,42,0.28)] backdrop-blur-xl lg:justify-end">
          <GlassButton
            size="sm"
            variant="ghost"
            className="mcp-runtime-toolbar-pill h-9 rounded-xl border border-white/70 bg-white/82 px-3.5 text-[12px] text-slate-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_10px_24px_-20px_rgba(15,23,42,0.25)] hover:bg-white/82"
          >
            {t("runtime.summary", { visible: filteredGroups.length, total: groups.length })}
          </GlassButton>
          {onSyncAll && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <GlassButton
                    size="sm"
                    variant="secondary"
                    className="mcp-runtime-toolbar-button h-9 rounded-xl border-white/70 bg-white/84 px-3.5 text-[12px] text-slate-700 shadow-[0_12px_28px_-20px_rgba(15,23,42,0.35)] hover:bg-white"
                    loading={syncAllLoading}
                    onClick={() => onSyncAll?.()}
                  >
                    <RefreshCw size={14} className={syncAllLoading ? "animate-spin" : ""} />
                    {syncAllLoading ? t("runtime.syncing") : t("runtime.sync")}
                  </GlassButton>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t("runtime.sync")}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {filteredGroups.map((group) => {
          const toneKey = getGroupToneKey(group)
          const tone = GROUP_TONES[toneKey]
          const sourceLabel = getSourceLabel(group)
          const runningRatio = `${group.runningCount}/${group.toolCount}`
          const runningPercent = group.toolCount > 0 ? Math.max(8, Math.round((group.runningCount / group.toolCount) * 100)) : 0
          const statusLabel = group.runningCount > 0 ? t("runtime.server.running") : t("tool.status.stopped")

          return (
            <GlassCard
              key={group.id}
              blur="lg"
              theme="default"
              hover="lift"
              padding="none"
              className="overflow-hidden border-white/30 shadow-[0_18px_48px_-30px_rgba(15,23,42,0.28)]"
            >
              <button
                type="button"
                className="relative w-full overflow-hidden px-4 py-4 text-left transition-colors hover:bg-white/35 sm:px-5"
                onClick={() => setSelectedGroupId(group.id)}
              >
                <div className={cn("pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r", tone.bar)} />
                <div className={cn("pointer-events-none absolute -top-12 right-0 h-28 w-28 rounded-full blur-3xl", tone.glow)} />

                <div className="relative flex items-center gap-4">
                  <div className={cn("flex size-11 shrink-0 items-center justify-center rounded-2xl border shadow-sm", tone.icon)}>
                    <Folder size={18} className={tone.iconText} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-slate-400">
                      <span>MCP</span>
                      <span className="h-1 w-1 rounded-full bg-slate-300" />
                      <span>{sourceLabel}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-lg font-semibold text-[var(--foreground)]">{group.name}</h3>
                      <Badge className={tone.badge}>{statusLabel}</Badge>
                    </div>
                    <p className="mt-2 line-clamp-1 text-sm text-[var(--muted)]">
                      {group.description || t("runtime.server.noDescription")}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-600">
                      <span className="rounded-full bg-slate-100 px-2.5 py-1">
                        {group.toolCount} {t("runtime.server.toolCount")}
                      </span>
                      {group.source?.pathOrUrl && (
                        <span className="max-w-[min(24rem,60vw)] truncate rounded-full bg-slate-100 px-2.5 py-1 font-mono text-[11px]">
                          {group.source.pathOrUrl}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-3">
                    <div className={cn("min-w-[88px] rounded-[1.1rem] border px-3 py-2 text-right shadow-sm", tone.metric)}>
                      <div className="text-[10px] uppercase tracking-[0.18em] opacity-70">
                        {t("runtime.server.running")}
                      </div>
                      <div className="mt-1 text-lg font-semibold">
                        {group.runningCount}
                        <span className="ml-1 text-sm font-medium opacity-60">/ {group.toolCount}</span>
                      </div>
                    </div>
                    <ChevronRight size={18} className="text-slate-400" />
                  </div>
                </div>

                <div className="relative mt-4 space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>{t("runtime.server.running")}</span>
                    <span>{runningRatio}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={cn("h-full rounded-full bg-gradient-to-r transition-all duration-500", tone.progress)}
                      style={{ width: `${runningPercent}%` }}
                    />
                  </div>
                </div>
              </button>
            </GlassCard>
          )
        })}

        {filteredGroups.length === 0 && (
          <div className="col-span-full flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50/30 py-16 text-gray-400">
            <Terminal size={32} className="mb-3 opacity-20" />
            <p className="text-sm">{t("runtime.empty")}</p>
          </div>
        )}
      </div>
    </section>
  )
}
