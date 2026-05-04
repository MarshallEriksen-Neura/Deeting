"use client"

import { useMemo, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  ArrowLeft,
  ChevronRight,
  Folder,
  Pencil,
  Play,
  RefreshCw,
  Search,
  Sparkles,
  Square,
  Terminal,
  Trash2,
} from "lucide-react"
import { useTranslations } from "next-intl"

import { Badge } from "@/components/ui/shadcn/badge"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/shadcn/alert-dialog"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/shadcn/tooltip"
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
  onStartGroup?: (tools: MCPTool[]) => Promise<void> | void
  onStopGroup?: (tools: MCPTool[]) => Promise<void> | void
  onDeleteGroup?: (tools: MCPTool[]) => Promise<void> | void
  onEditGroup?: (group: MCPRuntimeServerGroup) => void
  onUpdateGroup?: (group: MCPRuntimeServerGroup) => Promise<void> | void
  onSyncAll?: () => void
  syncAllLoading?: boolean
  onSyncTool?: (tool: MCPTool) => void
  syncingToolIds?: Record<string, boolean>
  onReindexMissingTools?: (tools: MCPTool[]) => void
  reindexMissingLoading?: boolean
}

type GroupTone = {
  icon: string
  iconText: string
  badge: string
  metric: string
  dot: string
}

const GROUP_TONES: Record<"healthy" | "partial" | "attention" | "idle", GroupTone> = {
  healthy: {
    icon: "border-[var(--ok-border)] bg-[var(--ok-soft)]",
    iconText: "text-[var(--ok)]",
    badge: "bg-[var(--ok-soft)] text-[var(--ok)] hover:bg-[var(--ok-soft)]",
    metric: "border-[var(--ok-border)] bg-[var(--ok-soft)] text-[var(--ok)]",
    dot: "bg-[var(--ok)]",
  },
  partial: {
    icon: "border-[var(--info-border)] bg-[var(--info-soft)]",
    iconText: "text-[var(--info)]",
    badge: "bg-[var(--info-soft)] text-[var(--info)] hover:bg-[var(--info-soft)]",
    metric: "border-[var(--info-border)] bg-[var(--info-soft)] text-[var(--info)]",
    dot: "bg-[var(--info)]",
  },
  attention: {
    icon: "border-[var(--warn-border)] bg-[var(--warn-soft)]",
    iconText: "text-[var(--warn)]",
    badge: "bg-[var(--warn-soft)] text-[var(--warn)] hover:bg-[var(--warn-soft)]",
    metric: "border-[var(--warn-border)] bg-[var(--warn-soft)] text-[var(--warn)]",
    dot: "bg-[var(--warn)]",
  },
  idle: {
    icon: "border-[var(--hairline)] bg-[var(--panel-bg-inset)]",
    iconText: "text-[var(--ink-4)]",
    badge: "bg-[var(--panel-bg-inset)] text-[var(--ink-3)] border-[var(--hairline)]",
    metric: "border-[var(--hairline)] bg-[var(--panel-bg-inset)] text-[var(--ink-3)]",
    dot: "bg-[var(--ink-4)]",
  },
}

const getGroupToneKey = (group: MCPRuntimeServerGroup): keyof typeof GROUP_TONES => {
  if (group.conflictCount > 0) return "attention"
  if (group.runningCount === 0) return "idle"
  if (group.runningCount === group.toolCount) return "healthy"
  return "partial"
}

type ServerGroupAction = "start" | "stop" | "delete" | "update"

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
  onStartGroup,
  onStopGroup,
  onDeleteGroup,
  onEditGroup,
  onUpdateGroup,
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
  const [pendingGroupAction, setPendingGroupAction] = useState<ServerGroupAction | null>(null)

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
    () => (selectedGroupId ? groups.find((group) => group.id === selectedGroupId) ?? null : null),
    [groups, selectedGroupId]
  )

  const runGroupAction = async (
    action: ServerGroupAction,
    callback: (() => Promise<void> | void) | undefined
  ) => {
    if (!callback || pendingGroupAction) return

    setPendingGroupAction(action)
    try {
      await callback()
    } finally {
      setPendingGroupAction(null)
    }
  }

  if (selectedGroup) {
    const toneKey = getGroupToneKey(selectedGroup)
    const tone = GROUP_TONES[toneKey]
    const representativeTool = selectedGroup.tools[0]
    const syncKey = representativeTool?.sourceId ?? representativeTool?.id
    const groupSyncLoading = Boolean(syncKey && syncingToolIds?.[syncKey])
    const canSyncGroup = platform === "cloud" && Boolean(representativeTool && onSyncTool)
    const canEditGroup = platform === "cloud" && Boolean(representativeTool && onEditServer)
    const canReviewGroup = Boolean(selectedGroup.conflictCount > 0 && representativeTool && onResolveConflict)
    const missingIndexTools = selectedGroup.tools.filter((tool) => isMcpIndexMissing(tool))
    const canReindexMissing =
      platform === "desktop" && missingIndexTools.length > 0 && Boolean(onReindexMissingTools)
    const canStartGroup = platform === "desktop" && Boolean(onStartGroup)
    const canStopGroup = platform === "desktop" && Boolean(onStopGroup)
    const canDeleteGroup = platform === "desktop" && Boolean(onDeleteGroup)
    const canEditSelectedGroup = platform === "desktop" && Boolean(onEditGroup)
    const canUpdateSelectedGroup = platform === "desktop" && Boolean(onUpdateGroup)
    const groupActionDisabled = Boolean(pendingGroupAction)

    return (
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 240, damping: 28, mass: 1 }}
        className="w-full min-w-0 space-y-5"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="flex h-[32px] items-center justify-center gap-1.5 rounded-[var(--r-8)] bg-[var(--panel-bg)] px-3 text-[12px] font-medium text-[var(--ink-2)] ring-1 ring-[var(--hairline)] shadow-sm transition-all hover:bg-[var(--panel-bg-inset)] hover:text-[var(--ink)] hover:ring-[var(--hairline-strong)]"
              onClick={() => setSelectedGroupId(null)}
            >
              <ArrowLeft size={14} />
              {t("runtime.workspace.back")}
            </button>
            <div className="flex h-[32px] items-center rounded-[var(--r-8)] bg-[var(--panel-bg-inset)] px-3 text-[12px] font-medium text-[var(--ink-3)] ring-1 ring-[var(--hairline)]">
              {t("runtime.workspace.summary", {
                name: selectedGroup.name,
                count: selectedGroup.toolCount,
              })}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {canReindexMissing && (
              <button
                type="button"
                className="flex h-[28px] items-center justify-center gap-1.5 rounded-[var(--r-6)] bg-[var(--panel-bg)] px-3 text-[11px] font-medium text-[var(--ink)] ring-1 ring-[var(--hairline)] transition-all hover:bg-[var(--panel-bg-inset)] hover:ring-[var(--hairline-strong)]"
                onClick={() => onReindexMissingTools?.(missingIndexTools)}
              >
                <Sparkles size={13} className={reindexMissingLoading ? "animate-spin" : ""} />
                {reindexMissingLoading ? t("actions.reindexingMissing") : t("actions.reindexMissing")}
              </button>
            )}
            {canReviewGroup && (
              <button
                type="button"
                className="flex h-[28px] items-center justify-center gap-1.5 rounded-[var(--r-6)] bg-[var(--panel-bg)] px-3 text-[11px] font-medium text-[var(--ink)] ring-1 ring-[var(--hairline)] transition-all hover:bg-[var(--panel-bg-inset)] hover:ring-[var(--hairline-strong)]"
                onClick={() => onResolveConflict?.(representativeTool)}
              >
                <Search size={13} />
                {t("runtime.server.review")}
              </button>
            )}
            {canSyncGroup && (
              <button
                type="button"
                className="flex h-[28px] w-[28px] items-center justify-center rounded-[var(--r-6)] text-[var(--ink-3)] transition-colors hover:bg-[var(--panel-bg-inset)] hover:text-[var(--ink)]"
                onClick={() => onSyncTool?.(representativeTool)}
              >
                <RefreshCw size={14} className={groupSyncLoading ? "animate-spin" : ""} />
              </button>
            )}
            {canEditGroup && (
              <button
                type="button"
                className="flex h-[28px] w-[28px] items-center justify-center rounded-[var(--r-6)] text-[var(--ink-3)] transition-colors hover:bg-[var(--panel-bg-inset)] hover:text-[var(--ink)]"
                onClick={() => onEditServer?.(representativeTool)}
              >
                <Pencil size={14} />
              </button>
            )}
          </div>
        </div>

        <div className="rounded-[var(--r-14)] border border-[var(--hairline)] bg-[var(--panel-bg)] shadow-[var(--elev-inset-hi)]">
              <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex min-w-0 items-start gap-4">
                  <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--r-10)] border shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]", tone.icon)}>
                    <Folder size={18} className={tone.iconText} />
                  </div>
                  <div className="min-w-0 flex-1 flex flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-[17px] font-semibold tracking-[-0.2px] text-[var(--ink)]">{selectedGroup.name}</h3>
                      <Badge className={cn("h-[20px] rounded-full px-2 text-[10px] font-semibold uppercase tracking-[0.04em] shadow-none", tone.badge)}>
                        {selectedGroup.runningCount > 0 ? t("runtime.server.running") : t("tool.status.stopped")}
                      </Badge>
                      {selectedGroup.conflictCount > 0 && (
                        <Badge variant="outline" className="h-[20px] rounded-full border-[var(--warn-border)] bg-[var(--warn-soft)] px-2 text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--warn)] shadow-none">
                          {selectedGroup.conflictCount} {t("runtime.server.conflicts")}
                        </Badge>
                      )}
                    </div>
                    <p className="line-clamp-2 text-[13px] leading-[1.5] text-[var(--ink-2)]">
                      {selectedGroup.description || t("runtime.server.noDescription")}
                    </p>
                    <div className="flex flex-wrap gap-2 text-[11px] font-mono text-[var(--ink-3)]">
                      <span className="rounded-[var(--r-4)] bg-[var(--panel-bg-inset)] px-1.5 py-[2px] border border-[var(--hairline)] tabular-nums">
                        {selectedGroup.toolCount} {t("runtime.server.toolCount")}
                      </span>
                      {selectedGroup.source?.pathOrUrl && (
                        <span className="max-w-[min(48rem,70vw)] truncate rounded-[var(--r-4)] bg-[var(--panel-bg-inset)] px-1.5 py-[2px] border border-[var(--hairline)]">
                          {selectedGroup.source.pathOrUrl}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex shrink-0 flex-col items-end gap-3">
                  <div className="flex flex-wrap justify-end gap-2">
                    {canStartGroup && (
                      <button
                        type="button"
                        className="flex h-[30px] items-center justify-center gap-1.5 rounded-[var(--r-6)] bg-[var(--panel-bg)] px-3 text-[11px] font-medium text-[var(--ink)] ring-1 ring-[var(--hairline)] transition-all hover:bg-[var(--panel-bg-inset)] hover:ring-[var(--hairline-strong)] disabled:cursor-not-allowed disabled:opacity-45"
                        onClick={() => void runGroupAction("start", () => onStartGroup?.(selectedGroup.tools))}
                        disabled={groupActionDisabled || selectedGroup.runningCount === selectedGroup.toolCount}
                      >
                        <Play size={13} className={pendingGroupAction === "start" ? "animate-pulse text-[var(--ok)]" : ""} />
                        {t("actions.start")}
                      </button>
                    )}
                    {canStopGroup && (
                      <button
                        type="button"
                        className="flex h-[30px] items-center justify-center gap-1.5 rounded-[var(--r-6)] bg-[var(--panel-bg)] px-3 text-[11px] font-medium text-[var(--ink)] ring-1 ring-[var(--hairline)] transition-all hover:bg-[var(--panel-bg-inset)] hover:ring-[var(--hairline-strong)] disabled:cursor-not-allowed disabled:opacity-45"
                        onClick={() => void runGroupAction("stop", () => onStopGroup?.(selectedGroup.tools))}
                        disabled={groupActionDisabled || selectedGroup.runningCount === 0}
                      >
                        <Square size={12} className={pendingGroupAction === "stop" ? "animate-pulse text-[var(--warn)]" : ""} />
                        {t("actions.stop")}
                      </button>
                    )}
                    {canUpdateSelectedGroup && (
                      <button
                        type="button"
                        className="flex h-[30px] items-center justify-center gap-1.5 rounded-[var(--r-6)] bg-[var(--panel-bg)] px-3 text-[11px] font-medium text-[var(--ink)] ring-1 ring-[var(--hairline)] transition-all hover:bg-[var(--panel-bg-inset)] hover:ring-[var(--hairline-strong)] disabled:cursor-not-allowed disabled:opacity-45"
                        onClick={() => void runGroupAction("update", () => onUpdateGroup?.(selectedGroup))}
                        disabled={groupActionDisabled}
                      >
                        <RefreshCw size={13} className={pendingGroupAction === "update" ? "animate-spin text-[var(--accent-strong)]" : ""} />
                        {t("actions.update")}
                      </button>
                    )}
                    {canEditSelectedGroup && (
                      <button
                        type="button"
                        className="flex h-[30px] items-center justify-center gap-1.5 rounded-[var(--r-6)] bg-[var(--panel-bg)] px-3 text-[11px] font-medium text-[var(--ink)] ring-1 ring-[var(--hairline)] transition-all hover:bg-[var(--panel-bg-inset)] hover:ring-[var(--hairline-strong)] disabled:cursor-not-allowed disabled:opacity-45"
                        onClick={() => onEditGroup?.(selectedGroup)}
                        disabled={groupActionDisabled}
                      >
                        <Pencil size={13} />
                        {t("actions.edit")}
                      </button>
                    )}
                    {canDeleteGroup && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <button
                            type="button"
                            className="flex h-[30px] items-center justify-center gap-1.5 rounded-[var(--r-6)] bg-[var(--danger-soft)] px-3 text-[11px] font-medium text-[var(--danger)] ring-1 ring-[var(--danger-border)] transition-all hover:bg-[var(--danger-soft)] hover:ring-[var(--danger-border)] disabled:cursor-not-allowed disabled:opacity-45"
                            disabled={groupActionDisabled}
                          >
                            <Trash2 size={13} />
                            {t("actions.delete")}
                          </button>
                        </AlertDialogTrigger>
                        <AlertDialogContent className="rounded-[var(--r-16)] bg-[var(--panel-bg)] text-[var(--ink)] ring-1 ring-[var(--hairline-strong)]">
                          <AlertDialogHeader>
                            <AlertDialogTitle>{t("server.delete.title")}</AlertDialogTitle>
                            <AlertDialogDescription>
                              {t("server.delete.description", { name: selectedGroup.name })}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{t("server.delete.cancel")}</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-[var(--danger)] text-white hover:bg-[var(--danger)]"
                              onClick={() => void runGroupAction("delete", () => onDeleteGroup?.(selectedGroup.tools))}
                            >
                              {pendingGroupAction === "delete" ? t("toast.deleting") : t("server.delete.confirm")}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                  <div className={cn("flex min-w-[88px] flex-col items-end justify-center rounded-[var(--r-10)] border px-3 py-2", tone.metric)}>
                    <div className="text-[9px] uppercase tracking-[0.18em] opacity-70">
                      {t("runtime.server.running")}
                    </div>
                    <div className="mt-0.5 font-mono text-[20px] font-semibold tabular-nums tracking-[-0.5px]">
                      {selectedGroup.runningCount}
                      <span className="ml-1 text-[13px] font-medium opacity-60">/ {selectedGroup.toolCount}</span>
                    </div>
                  </div>
                </div>
              </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between border-b border-[var(--hairline)] pb-2">
            <h4 className="text-[11px] font-medium uppercase tracking-[0.2em] text-[var(--ink-3)]">
              {t("runtime.workspace.tools")} ({selectedGroup.toolCount})
            </h4>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3">
            <AnimatePresence mode="popLayout">
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
            </AnimatePresence>
          </div>
        </div>
      </motion.section>
    )
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 240, damping: 28, mass: 1 }}
      className="w-full min-w-0 space-y-4"
    >
      <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex h-[32px] items-center gap-1 border-b border-[var(--hairline)]">
          {[
            { value: "all", label: t("runtime.tabs.all"), count: null, tone: "slate" },
            { value: "running", label: t("runtime.tabs.running"), count: runningCount, tone: "emerald" },
            { value: "stopped", label: t("runtime.tabs.stopped"), count: null, tone: "slate" },
            { value: "conflicts", label: t("runtime.tabs.conflicts"), count: conflictCount, tone: "amber" },
          ].map((item) => {
            const isActive = activeTab === item.value
            return (
              <button
                key={item.value}
                data-active={isActive ? "true" : "false"}
                className={cn(
                  "relative flex h-[32px] items-center gap-2 px-3 text-[13px] font-medium leading-none transition-colors",
                  isActive ? "text-[var(--ink)] border-b-2 border-[var(--accent-strong)]" : "text-[var(--ink-2)] border-b-2 border-transparent hover:text-[var(--ink)]"
                )}
                onClick={() => setActiveTab(item.value)}
              >
                {item.label}
                {typeof item.count === "number" && item.count > 0 && (
                  <span className={cn(
                    "flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 font-mono text-[10px] tabular-nums tracking-tight",
                    item.tone === "emerald" ? (isActive ? "bg-[var(--ok)] text-white" : "bg-[var(--ok-soft)] text-[var(--ok)]") :
                    item.tone === "amber" ? (isActive ? "bg-[var(--warn)] text-white" : "bg-[var(--warn-soft)] text-[var(--warn)]") :
                    "bg-[var(--panel-bg-inset)] text-[var(--ink-2)] ring-1 ring-[var(--hairline)]"
                  )}>
                    {item.count}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex h-[32px] items-center rounded-[var(--r-8)] bg-[var(--panel-bg-inset)] px-3 text-[12px] font-medium text-[var(--ink-3)] ring-1 ring-[var(--hairline)]">
            {t("runtime.summary", { visible: filteredGroups.length, total: groups.length })}
          </div>
          {onSyncAll && (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="flex h-[32px] items-center justify-center gap-1.5 rounded-[var(--r-8)] bg-[var(--panel-bg)] px-3 text-[12px] font-medium text-[var(--ink)] ring-1 ring-[var(--hairline)] transition-all hover:bg-[var(--panel-bg-inset)] hover:ring-[var(--hairline-strong)]"
                    onClick={() => onSyncAll?.()}
                    disabled={syncAllLoading}
                  >
                    <RefreshCw size={14} className={syncAllLoading ? "animate-spin text-[var(--accent-strong)]" : ""} />
                    {syncAllLoading ? t("runtime.syncing") : t("runtime.sync")}
                  </button>
                </TooltipTrigger>
                <TooltipContent className="rounded-[var(--r-8)] bg-[var(--panel-bg)] text-[11px] font-medium text-[var(--ink)] shadow-xl ring-1 ring-[var(--hairline-strong)]">
                  <p>{t("runtime.sync")}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-[var(--r-14)] border border-[var(--hairline)] bg-[var(--panel-bg)] shadow-[var(--elev-inset-hi)]">
        <AnimatePresence mode="popLayout">
          {filteredGroups.map((group) => {
            const toneKey = getGroupToneKey(group)
            const tone = GROUP_TONES[toneKey]
            const statusLabel = group.runningCount > 0 ? t("runtime.server.running") : t("tool.status.stopped")

            return (
              <motion.div
                layout
                key={group.id}
                className="group relative border-b border-[var(--hairline-subtle)] transition-all duration-[220ms] ease-[cubic-bezier(0.32,0.72,0,1)] last:border-b-0"
              >
                  <button
                    type="button"
                    className="relative grid min-h-[74px] w-full grid-cols-[minmax(260px,1fr)_minmax(260px,0.72fr)_auto] items-center gap-4 px-4 text-left transition-colors hover:bg-[var(--panel-bg-inset)]/58 focus-visible:outline-none"
                    onClick={() => setSelectedGroupId(group.id)}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--r-10)] border shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]", tone.icon)}>
                        <Folder size={16} className={tone.iconText} />
                      </div>

                      <div className="min-w-0 flex-1 flex flex-col gap-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <h3 className="truncate text-[14px] font-semibold tracking-[-0.1px] text-[var(--ink)]">{group.name}</h3>
                          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", tone.dot)} />
                          <Badge variant="outline" className={cn("h-[18px] rounded-full px-2 text-[9px] font-semibold uppercase tracking-[0.04em] shadow-none", tone.badge)}>
                            {statusLabel}
                          </Badge>
                        </div>
                        <p className="line-clamp-1 text-[13px] leading-[1.5] text-[var(--ink-2)]">
                          {group.description || t("runtime.server.noDescription")}
                        </p>
                      </div>
                    </div>

                    <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[10px] font-mono text-[var(--ink-3)]">
                          <span className="rounded-[var(--r-4)] bg-[var(--panel-bg)] px-1.5 py-0.5 border border-[var(--hairline)] tabular-nums">
                            {group.toolCount} {t("runtime.server.toolCount")}
                          </span>
                          {group.source?.pathOrUrl && (
                            <span className="max-w-[min(20rem,50vw)] truncate rounded-[var(--r-4)] bg-[var(--panel-bg)] px-1.5 py-0.5 border border-[var(--hairline)]">
                              {group.source.pathOrUrl}
                            </span>
                          )}
                      </div>

                    <div className="flex shrink-0 items-center justify-end gap-3">
                      <div className={cn("flex min-w-[72px] items-center justify-center rounded-[var(--r-8)] border px-2.5 py-1.5", tone.metric)}>
                        <span className="font-mono text-[14px] font-semibold tabular-nums tracking-[-0.3px]">
                          {group.runningCount}<span className="ml-[2px] text-[11px] font-medium opacity-60">/ {group.toolCount}</span>
                        </span>
                      </div>
                      <ChevronRight size={16} className="text-[var(--ink-3)] transition-transform group-hover:translate-x-[2px]" />
                    </div>
                  </button>
              </motion.div>
            )
          })}
        </AnimatePresence>

        {filteredGroups.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="col-span-full flex min-w-0 flex-col items-center justify-center rounded-[var(--r-18)] border border-dashed border-[var(--hairline-strong)] bg-[var(--panel-bg-inset)] py-[56px] text-[var(--ink-3)]"
          >
            <Terminal size={32} className="mb-3 opacity-30" strokeWidth={1} />
            <p className="text-[13px] font-medium">{t("runtime.empty")}</p>
            <p className="mt-1 text-[11px] text-[var(--ink-4)]">Press ⌘K to search</p>
          </motion.div>
        )}
      </div>
    </motion.section>
  )
}
