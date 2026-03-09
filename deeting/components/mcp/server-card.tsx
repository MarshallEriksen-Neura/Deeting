"use client"

import { useState, type MouseEvent } from "react"
import { Terminal, AlertCircle, RefreshCw, MoreHorizontal, Pencil, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { GlassButton } from "@/components/ui/glass-button"
import { GlassCard } from "@/components/ui/glass-card"
import { Switch } from "@/components/ui/switch"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { GlassDropdownMenu, GlassDropdownMenuContent, GlassDropdownMenuItem, GlassDropdownMenuTrigger } from "@/components/ui/glass-dropdown"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import {
  type McpUiToggleMode,
  getMcpIndexLabelKey,
  getMcpPrimaryActionLabelKey,
  getMcpRuntimeHintKey,
  getMcpRuntimeLabelKey,
  isMcpIndexMissing,
  isMcpRuntimeLive,
  isMcpRuntimeTransitioning,
  isMcpToolSwitchChecked,
  isMcpToolSwitchDisabled,
} from "@/components/mcp/tool-semantics"
import { cn } from "@/lib/utils"
import { MCPTool, MCPToolStatus } from "@/types/mcp"
import { useTranslations } from "next-intl"

interface ServerCardProps {
  tool: MCPTool
  toggleMode?: McpUiToggleMode
  onToggle?: (tool: MCPTool, enabled: boolean) => void
  onPrimaryAction?: () => void
  onClick?: () => void
  onResolveConflict?: () => void
  onSync?: () => void
  syncLoading?: boolean
  onEdit?: () => void
  onDelete?: () => void
}

// Status-driven visual theme for accent bar, dot, and icon
const statusTheme: Record<MCPToolStatus, {
  bar: string
  dot: string
  dotPing?: string
  iconBg: string
  iconText: string
  label: string
}> = {
  healthy: {
    bar: "from-emerald-400 via-emerald-500 to-teal-500",
    dot: "bg-emerald-500 shadow-sm shadow-emerald-500/50",
    dotPing: "bg-emerald-400",
    iconBg: "bg-gradient-to-br from-emerald-500/12 to-teal-500/8 border-emerald-400/25",
    iconText: "text-emerald-600",
    label: "text-emerald-600",
  },
  degraded: {
    bar: "from-amber-400 via-orange-400 to-orange-500",
    dot: "bg-orange-400 shadow-sm shadow-orange-400/50",
    iconBg: "bg-gradient-to-br from-amber-500/12 to-orange-500/8 border-amber-400/25",
    iconText: "text-amber-600",
    label: "text-amber-600",
  },
  crashed: {
    bar: "from-red-400 via-red-500 to-rose-500",
    dot: "bg-red-500 shadow-sm shadow-red-500/50",
    iconBg: "bg-gradient-to-br from-red-500/12 to-rose-500/8 border-red-400/25",
    iconText: "text-red-600",
    label: "text-red-600",
  },
  starting: {
    bar: "from-yellow-400 via-amber-400 to-amber-500",
    dot: "bg-yellow-400 shadow-sm shadow-yellow-400/50 animate-pulse",
    iconBg: "bg-gradient-to-br from-yellow-500/12 to-amber-500/8 border-yellow-400/25",
    iconText: "text-yellow-600",
    label: "text-yellow-600",
  },
  updating: {
    bar: "from-blue-400 via-blue-500 to-indigo-500",
    dot: "bg-blue-500 shadow-sm shadow-blue-500/50 animate-pulse",
    iconBg: "bg-gradient-to-br from-blue-500/12 to-indigo-500/8 border-blue-400/25",
    iconText: "text-blue-600",
    label: "text-blue-600",
  },
  pending: {
    bar: "from-gray-300 via-gray-400 to-slate-400",
    dot: "bg-gray-300 shadow-sm shadow-gray-300/30",
    iconBg: "bg-gradient-to-br from-gray-500/8 to-slate-500/5 border-gray-300/30",
    iconText: "text-gray-500",
    label: "text-gray-500",
  },
  orphaned: {
    bar: "from-gray-300 via-gray-400 to-slate-400",
    dot: "bg-gray-400 shadow-sm shadow-gray-400/30",
    iconBg: "bg-gradient-to-br from-gray-500/8 to-slate-500/5 border-gray-300/30",
    iconText: "text-gray-500",
    label: "text-gray-500",
  },
  error: {
    bar: "from-red-400 via-red-500 to-rose-500",
    dot: "bg-red-400 shadow-sm shadow-red-400/50",
    iconBg: "bg-gradient-to-br from-red-500/12 to-rose-500/8 border-red-400/25",
    iconText: "text-red-500",
    label: "text-red-500",
  },
  stopped: {
    bar: "from-gray-200 via-gray-300 to-slate-300",
    dot: "border-[1.5px] border-gray-300 bg-transparent",
    iconBg: "bg-white/40 border-white/20",
    iconText: "text-gray-400",
    label: "text-gray-400",
  },
}

const StatusDot = ({ status }: { status: MCPToolStatus }) => {
  const theme = statusTheme[status]
  const showPing = status === "healthy"

  return (
    <span className="relative flex h-2 w-2 shrink-0">
      {showPing && (
        <span className={cn("animate-ping absolute inline-flex h-full w-full rounded-full opacity-75", theme.dotPing)} />
      )}
      <span className={cn("relative inline-flex rounded-full h-2 w-2", theme.dot)} />
    </span>
  )
}

export function ServerCard({
  tool,
  toggleMode = "runtime",
  onToggle,
  onPrimaryAction,
  onClick,
  onResolveConflict,
  onSync,
  syncLoading = false,
  onEdit,
  onDelete,
}: ServerCardProps) {
  const t = useTranslations("mcp")
  const [confirmOpen, setConfirmOpen] = useState(false)
  const isSynced = tool.source !== "local"
  const isRunning = isMcpRuntimeLive(tool)
  const showConflict = tool.conflictStatus === "conflict"
  const showUpdate = tool.conflictStatus === "update_available"
  const showNew = tool.isNew && !showConflict && !showUpdate
  const showMenu = Boolean(onEdit || onDelete)
  const theme = statusTheme[tool.status]
  const isActive = isRunning || isMcpRuntimeTransitioning(tool)
  const runtimeHintKey = getMcpRuntimeHintKey(tool)
  const runtimeLabelKey = getMcpRuntimeLabelKey(tool)
  const showIndexMissing = isMcpIndexMissing(tool)
  const indexLabelKey = getMcpIndexLabelKey(tool)
  const primaryActionLabelKey = getMcpPrimaryActionLabelKey(tool)
  const showPrimaryAction = Boolean(primaryActionLabelKey && onPrimaryAction)

  return (
    <GlassCard
      onClick={(e: MouseEvent<HTMLDivElement>) => {
        if (
          (e.target as HTMLElement).closest("button") ||
          (e.target as HTMLElement).closest('[role="switch"]') ||
          (e.target as HTMLElement).closest("[data-mcp-action]")
        )
          return
        onClick?.()
      }}
      blur="lg"
      theme={showConflict || showUpdate ? "primary" : "default"}
      hover="lift"
      padding="none"
      className={cn(
        "group cursor-pointer transition-all duration-300",
        (showConflict || showUpdate) && "ring-2 ring-amber-400/30"
      )}
    >
      {/* Status accent bar - top gradient line for instant visual scanning */}
      <div
        className={cn(
          "h-[2px] rounded-t-2xl bg-gradient-to-r transition-all duration-500",
          theme.bar,
          !isActive && "opacity-30"
        )}
      />

      <div className="p-5 flex flex-col gap-3">
        {/* Header: Icon + Info + Actions */}
        <div className="flex items-start gap-3">
          {/* Icon - tinted by status when running, or by source type */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className={cn(
                    "relative p-2.5 rounded-xl border backdrop-blur-sm transition-all duration-300 shrink-0",
                    isActive
                      ? theme.iconBg
                      : isSynced
                        ? "bg-gradient-to-br from-purple-500/10 to-purple-600/5 border-purple-400/20"
                        : "bg-white/40 border-white/20"
                  )}
                >
                  <Terminal
                    size={18}
                    strokeWidth={2}
                    className={cn(
                      "transition-colors duration-300",
                      isActive ? theme.iconText : isSynced ? "text-purple-600" : "text-gray-600"
                    )}
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="font-mono text-xs">
                  {t("tool.labels.id")}: {tool.identifier || tool.id}
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Name + Compact meta line */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-[var(--foreground)] truncate">{tool.name}</h3>
              {/* Alert badges - only the most important one */}
              {showConflict && (
                <Badge
                  variant="outline"
                  className="text-[10px] h-5 px-1.5 border-amber-400/50 bg-gradient-to-r from-amber-50 to-orange-50 text-amber-700 gap-1 animate-pulse cursor-pointer hover:bg-amber-100 transition-all shrink-0 shadow-sm shadow-amber-500/10"
                  onClick={(e) => {
                    e.stopPropagation()
                    onResolveConflict?.()
                  }}
                >
                  <AlertCircle size={10} /> {t("tool.badges.conflict")}
                </Badge>
              )}
              {showUpdate && !showConflict && (
                <Badge
                  variant="outline"
                  className="text-[10px] h-5 px-1.5 border-amber-300/70 bg-gradient-to-r from-amber-50 to-yellow-50 text-amber-700 gap-1 cursor-pointer hover:bg-amber-100 transition-all shrink-0 shadow-sm shadow-amber-500/10"
                  onClick={(e) => {
                    e.stopPropagation()
                    onResolveConflict?.()
                  }}
                >
                  <AlertCircle size={10} /> {t("tool.badges.update")}
                </Badge>
              )}
              {showNew && (
                <Badge
                  variant="outline"
                  className="text-[10px] h-5 px-1.5 text-emerald-600 border-emerald-200/70 bg-emerald-50/80 shrink-0"
                >
                  {t("tool.badges.new")}
                </Badge>
              )}
              {!showConflict && !showUpdate && runtimeHintKey && (
                <Badge
                  variant="outline"
                  className="text-[10px] h-5 px-1.5 border-slate-200/80 bg-slate-50/80 text-slate-600 shrink-0"
                >
                  {t(runtimeLabelKey)}
                </Badge>
              )}
              {!showConflict && !showUpdate && !runtimeHintKey && showIndexMissing && (
                <Badge
                  variant="outline"
                  className="text-[10px] h-5 px-1.5 border-purple-200/80 bg-purple-50/80 text-purple-700 shrink-0"
                >
                  {t(indexLabelKey)}
                </Badge>
              )}
            </div>

            {/* Meta line: status dot + status text + latency + source */}
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              <StatusDot status={tool.status} />
              <span className={cn("text-[11px] font-medium", theme.label)}>
                {t(`tool.status.${tool.status}`)}
              </span>
              {tool.ping !== "-" && isRunning && (
                <>
                  <span className="text-[var(--border)]">·</span>
                  <span className="text-[11px] font-mono text-[var(--muted)]">{tool.ping}</span>
                </>
              )}
              <span className="text-[var(--border)]">·</span>
              <span
                className={cn(
                  "text-[11px] font-medium",
                  isSynced ? "text-purple-600/70" : "text-[var(--muted)]"
                )}
              >
                {isSynced ? t("tool.badges.synced") : t("tool.badges.local")}
              </span>
            </div>
          </div>

          {/* Actions - switch always visible, others on hover */}
          <div className="flex items-center gap-2 shrink-0" data-mcp-action>
            {showPrimaryAction && primaryActionLabelKey && (
              <GlassButton
                size="sm"
                variant={tool.recommendedAction === "review" ? "secondary" : "outline"}
                onClick={(event) => {
                  event.stopPropagation()
                  onPrimaryAction?.()
                }}
              >
                {t(primaryActionLabelKey)}
              </GlassButton>
            )}
            <Switch
              checked={isMcpToolSwitchChecked(tool, toggleMode)}
              onCheckedChange={(checked) => onToggle?.(tool, checked)}
              disabled={isMcpToolSwitchDisabled(tool, toggleMode)}
              className="data-[state=checked]:bg-gradient-to-r data-[state=checked]:from-purple-600 data-[state=checked]:to-purple-500"
            />
            {isSynced && onSync && (
              <GlassButton
                size="icon-sm"
                variant="ghost"
                className={cn(
                  "text-gray-400 hover:text-gray-900 transition-all",
                  !syncLoading && "opacity-0 group-hover:opacity-100"
                )}
                loading={syncLoading}
                onClick={(event) => {
                  event.stopPropagation()
                  onSync?.()
                }}
              >
                <RefreshCw size={14} className={syncLoading ? "animate-spin" : ""} />
              </GlassButton>
            )}
            {showMenu && (
              <GlassDropdownMenu>
                <GlassDropdownMenuTrigger asChild>
                  <GlassButton
                    size="icon-sm"
                    variant="ghost"
                    className="text-gray-400 hover:text-gray-900 opacity-0 group-hover:opacity-100 transition-all"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <MoreHorizontal size={14} />
                  </GlassButton>
                </GlassDropdownMenuTrigger>
                <GlassDropdownMenuContent align="end" className="w-[180px]">
                  {onEdit && (
                    <GlassDropdownMenuItem
                      onClick={(event) => {
                        event.stopPropagation()
                        onEdit?.()
                      }}
                    >
                      <Pencil size={14} />
                      {t("server.actions.edit")}
                    </GlassDropdownMenuItem>
                  )}
                  {onDelete && (
                    <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                      <AlertDialogTrigger asChild>
                        <GlassDropdownMenuItem
                          variant="destructive"
                          onSelect={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            setConfirmOpen(true)
                          }}
                        >
                          <Trash2 size={14} />
                          {t("server.actions.delete")}
                        </GlassDropdownMenuItem>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{t("server.delete.title")}</AlertDialogTitle>
                          <AlertDialogDescription>
                            {t("server.delete.description", { name: tool.name })}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{t("server.delete.cancel")}</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-red-600 hover:bg-red-500 text-white"
                            onClick={() => {
                              onDelete?.()
                              setConfirmOpen(false)
                            }}
                          >
                            {t("server.delete.confirm")}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </GlassDropdownMenuContent>
              </GlassDropdownMenu>
            )}
          </div>
        </div>

        {/* Description */}
        <div className="min-h-[2em]">
          <p className="text-sm text-[var(--muted)] line-clamp-2 leading-relaxed">{tool.description}</p>
          {tool.runtimeStatusReason && runtimeHintKey && (
            <div className="mt-2 text-slate-600 text-xs bg-slate-50/80 backdrop-blur-sm border border-slate-200/60 px-3 py-1.5 rounded-lg shadow-sm">
              <span className="font-semibold">{t("tool.labels.runtime")}:</span> {t(runtimeLabelKey)}
            </div>
          )}
          {tool.indexStatus === "missing" && (
            <div className="mt-2 text-purple-700 text-xs bg-purple-50/80 backdrop-blur-sm border border-purple-200/60 px-3 py-1.5 rounded-lg shadow-sm">
              <span className="font-semibold">{t("tool.labels.index")}:</span> {t(indexLabelKey)}
            </div>
          )}
          {(tool.status === "crashed" || tool.status === "error") && tool.error && (
            <div className="mt-2 text-red-600 font-mono text-xs bg-red-50/80 backdrop-blur-sm border border-red-200/50 px-3 py-1.5 rounded-lg shadow-sm">
              <span className="font-semibold">{t("tool.labels.error")}:</span> {tool.error}
            </div>
          )}
        </div>

        {/* Footer: Capability chips */}
        {tool.capabilities.length > 0 && (
          <div className="flex items-center gap-1.5 pt-2.5 border-t border-[var(--border)]/20">
            {tool.capabilities.map((cap) => (
              <span
                key={cap}
                className="text-[10px] bg-[var(--surface)]/60 text-[var(--muted)] px-2 py-0.5 rounded-md border border-[var(--border)]/30 font-mono tracking-tight"
              >
                {cap}
              </span>
            ))}
          </div>
        )}
      </div>
    </GlassCard>
  )
}
