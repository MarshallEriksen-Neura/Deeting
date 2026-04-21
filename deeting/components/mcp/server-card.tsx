"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Terminal, AlertCircle, RefreshCw, MoreHorizontal, Pencil, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/shadcn/badge"
import { Card } from "@/components/ui/shadcn/card"
import { Switch } from "@/components/ui/shadcn/switch"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/shadcn/alert-dialog"
import { GlassDropdownMenu, GlassDropdownMenuContent, GlassDropdownMenuItem, GlassDropdownMenuTrigger } from "@/components/ui/common/glass-dropdown"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/shadcn/tooltip"
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

type ServerCardPlatform = "desktop" | "cloud"

interface ServerCardProps {
  tool: MCPTool
  platform?: ServerCardPlatform
  toggleMode?: McpUiToggleMode
  density?: "default" | "compact"
  onToggle?: (tool: MCPTool, enabled: boolean) => void
  onPrimaryAction?: () => void
  onResolveConflict?: () => void
  onSync?: () => void
  syncLoading?: boolean
  onEdit?: () => void
  onDelete?: () => void
}

const statusTheme: Record<MCPToolStatus, {
  bar: string
  dot: string
  dotPing?: string
  iconBg: string
  iconText: string
  label: string
}> = {
  healthy: {
    bar: "from-[var(--ok)] to-[#5BDFA0]",
    dot: "bg-[var(--ok)] shadow-[0_0_8px_rgba(31,149,102,0.6)]",
    dotPing: "bg-[var(--ok)]",
    iconBg: "bg-[var(--ok-soft)] border-[var(--ok-border)]",
    iconText: "text-[var(--ok)]",
    label: "text-[var(--ok)]",
  },
  degraded: {
    bar: "from-[var(--warn)] to-[#F1B85A]",
    dot: "bg-[var(--warn)] shadow-[0_0_8px_rgba(196,131,18,0.6)]",
    iconBg: "bg-[var(--warn-soft)] border-[var(--warn-border)]",
    iconText: "text-[var(--warn)]",
    label: "text-[var(--warn)]",
  },
  crashed: {
    bar: "from-[var(--danger)] to-[#FF7A9A]",
    dot: "bg-[var(--danger)] shadow-[0_0_8px_rgba(212,71,106,0.6)]",
    iconBg: "bg-[var(--danger-soft)] border-[var(--danger-border)]",
    iconText: "text-[var(--danger)]",
    label: "text-[var(--danger)]",
  },
  starting: {
    bar: "from-[var(--info)] to-[#6FB0FF]",
    dot: "bg-[var(--info)] shadow-[0_0_8px_rgba(42,127,255,0.6)] animate-pulse",
    iconBg: "bg-[var(--info-soft)] border-transparent",
    iconText: "text-[var(--info)]",
    label: "text-[var(--info)]",
  },
  updating: {
    bar: "from-[var(--accent)] to-[#A6B0FF]",
    dot: "bg-[var(--accent)] shadow-[0_0_8px_rgba(109,92,255,0.6)] animate-pulse",
    iconBg: "bg-[var(--accent-soft)] border-[var(--accent-border)]",
    iconText: "text-[var(--accent-ink)]",
    label: "text-[var(--accent-ink)]",
  },
  pending: {
    bar: "from-slate-400 to-slate-500",
    dot: "bg-[var(--ink-3)]",
    iconBg: "bg-[var(--panel-bg-inset)] border-[var(--hairline)]",
    iconText: "text-[var(--ink-3)]",
    label: "text-[var(--ink-3)]",
  },
  orphaned: {
    bar: "from-slate-400 to-slate-500",
    dot: "bg-[var(--ink-3)]",
    iconBg: "bg-[var(--panel-bg-inset)] border-[var(--hairline)]",
    iconText: "text-[var(--ink-3)]",
    label: "text-[var(--ink-3)]",
  },
  error: {
    bar: "from-[var(--danger)] to-[#FF7A9A]",
    dot: "bg-[var(--danger)]",
    iconBg: "bg-[var(--danger-soft)] border-[var(--danger-border)]",
    iconText: "text-[var(--danger)]",
    label: "text-[var(--danger)]",
  },
  stopped: {
    bar: "from-[var(--chrome-bg)] to-[var(--panel-bg-inset)]",
    dot: "border border-[var(--hairline-strong)] bg-transparent",
    iconBg: "bg-[var(--panel-bg-inset)] border-[var(--hairline)]",
    iconText: "text-[var(--ink-4)]",
    label: "text-[var(--ink-3)]",
  },
}

const StatusDot = ({ status }: { status: MCPToolStatus }) => {
  const theme = statusTheme[status]
  const showPing = status === "healthy" || status === "starting" || status === "updating"

  return (
    <span className="relative flex h-[6px] w-[6px] shrink-0 items-center justify-center">
      {showPing && (
        <span className={cn("animate-ping absolute inline-flex h-[12px] w-[12px] rounded-full opacity-40", theme.dotPing || theme.dot)} />
      )}
      <span className={cn("relative inline-flex rounded-full h-[6px] w-[6px]", theme.dot)} />
    </span>
  )
}

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { 
    opacity: 1, 
    y: 0, 
    transition: { type: "spring", stiffness: 240, damping: 28, mass: 1 } 
  }
}

export function ServerCard({
  tool,
  platform = "cloud",
  toggleMode = "runtime",
  density = "default",
  onToggle,
  onPrimaryAction,
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
  const showInlineToggle = platform !== "desktop" && Boolean(onToggle)
  const showDesktopToggleAction = platform === "desktop" && Boolean(onToggle)
  const showMenu = platform === "desktop" ? Boolean(onToggle || onDelete) : Boolean(onEdit || onDelete)
  const theme = statusTheme[tool.status]
  const isActive = isRunning || isMcpRuntimeTransitioning(tool)
  const runtimeHintKey = getMcpRuntimeHintKey(tool)
  const runtimeLabelKey = getMcpRuntimeLabelKey(tool)
  const showIndexMissing = isMcpIndexMissing(tool)
  const indexLabelKey = getMcpIndexLabelKey(tool)
  const primaryActionLabelKey = getMcpPrimaryActionLabelKey(tool)
  const showPrimaryAction = platform !== "desktop" && Boolean(primaryActionLabelKey && onPrimaryAction)
  const toggleChecked = isMcpToolSwitchChecked(tool, toggleMode)
  const toggleDisabled = isMcpToolSwitchDisabled(tool, toggleMode)
  const toggleActionLabelKey = toggleChecked ? "actions.stop" : "actions.start"
  const deleteActionLabelKey = platform === "desktop" ? "actions.delete" : "server.actions.delete"
  const deleteDialogKeyPrefix = platform === "desktop" ? "tool.delete" : "server.delete"
  const isCompact = density === "compact"

  return (
    <motion.div
      layout
      variants={itemVariants}
      className={cn(
        "group relative rounded-[18px] p-[6px] transition-all duration-[220ms] ease-[cubic-bezier(0.32,0.72,0,1)]",
        "bg-[var(--panel-bg-inset)] ring-1 ring-[var(--hairline)] hover:ring-[var(--hairline-strong)]",
        "shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]",
        (showConflict || showUpdate) && "ring-[var(--warn-border)] bg-[var(--warn-soft)]"
      )}
    >
      <Card className={cn(
        "relative flex flex-col gap-0 overflow-hidden border-0 py-0",
        "rounded-[12px] bg-[var(--panel-bg)] ring-1 ring-[var(--hairline)]",
        "shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]",
        isCompact ? "h-full" : "min-h-[160px]"
      )}>
        {/* Top Status Gradient */}
        <div
          className={cn(
            "absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r transition-all duration-500",
            theme.bar,
            !isActive && "opacity-30 grayscale-[50%]"
          )}
        />

        <div className={cn("flex flex-1 flex-col", isCompact ? "gap-2.5 p-3.5" : "gap-3 p-4")}>
          {/* Header Row */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              {/* Double-Bezel Icon */}
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      className={cn(
                        "relative shrink-0 transition-all duration-[320ms]",
                        "rounded-[10px] border shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]",
                        isCompact ? "p-2" : "p-2.5",
                        isActive ? theme.iconBg : isSynced ? "bg-[var(--accent-soft)] border-[var(--accent-border)]" : "bg-[var(--panel-bg-inset)] border-[var(--hairline)]"
                      )}
                    >
                      <Terminal
                        size={16}
                        strokeWidth={1.5}
                        className={cn(
                          "transition-colors duration-300",
                          isActive ? theme.iconText : isSynced ? "text-[var(--accent)]" : "text-[var(--ink-2)]"
                        )}
                      />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" align="start" className="rounded-[8px] bg-[var(--panel-bg)] text-[11px] font-[500] text-[var(--ink)] shadow-xl ring-1 ring-[var(--hairline-strong)]">
                    <p className="font-mono tabular-nums tracking-wide">
                      {tool.identifier || tool.id}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              {/* Title & Metadata */}
              <div className="flex flex-1 min-w-0 flex-col gap-1 mt-0.5">
                <div className="flex items-center gap-2">
                  <h3 className={cn(
                    "truncate font-[600] text-[var(--ink)] tracking-[-0.1px]",
                    isCompact ? "text-[13px]" : "text-[14px]"
                  )}>
                    {tool.name}
                  </h3>
                  
                  {/* Status Pills */}
                  <AnimatePresence>
                    {showConflict && (
                      <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
                        <Badge variant="outline" className="h-[20px] rounded-full border-[var(--warn-border)] bg-[var(--warn-soft)] px-2 text-[10px] font-[600] uppercase tracking-[0.04em] text-[var(--warn)] shadow-none" onClick={(e) => { e.stopPropagation(); onResolveConflict?.(); }}>
                          <AlertCircle size={10} className="mr-1" /> {t("tool.badges.conflict")}
                        </Badge>
                      </motion.div>
                    )}
                    {showUpdate && !showConflict && (
                      <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
                        <Badge variant="outline" className="h-[20px] rounded-full border-[var(--warn-border)] bg-[var(--warn-soft)] px-2 text-[10px] font-[600] uppercase tracking-[0.04em] text-[var(--warn)] shadow-none" onClick={(e) => { e.stopPropagation(); onResolveConflict?.(); }}>
                          <AlertCircle size={10} className="mr-1" /> {t("tool.badges.update")}
                        </Badge>
                      </motion.div>
                    )}
                    {showNew && (
                      <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
                        <Badge variant="outline" className="h-[20px] rounded-full border-[var(--ok-border)] bg-[var(--ok-soft)] px-2 text-[10px] font-[600] uppercase tracking-[0.04em] text-[var(--ok)] shadow-none">
                          {t("tool.badges.new")}
                        </Badge>
                      </motion.div>
                    )}
                    {!showConflict && !showUpdate && runtimeHintKey && (
                      <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
                        <Badge variant="outline" className="h-[20px] rounded-full border-[var(--hairline)] bg-[var(--panel-bg-inset)] px-2 text-[10px] font-[600] uppercase tracking-[0.04em] text-[var(--ink-2)] shadow-none">
                          {t(runtimeLabelKey)}
                        </Badge>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <div className="flex items-center flex-wrap gap-1.5 text-[11px] font-[500] uppercase tracking-[0.02em]">
                  <div className="flex items-center gap-1.5 rounded-[4px] bg-[var(--panel-bg-inset)] px-1.5 py-[2px] ring-1 ring-[var(--hairline)]">
                    <StatusDot status={tool.status} />
                    <span className={theme.label}>{t(`tool.status.${tool.status}`)}</span>
                  </div>
                  
                  {tool.ping !== "-" && isRunning && (
                    <span className="font-mono tabular-nums text-[var(--ink-3)] tracking-[0] flex items-center gap-1">
                      <span className="h-[3px] w-[3px] rounded-full bg-[var(--hairline-strong)]" />
                      {tool.ping}
                    </span>
                  )}
                  
                  <span className="flex items-center gap-1 text-[var(--ink-3)]">
                    <span className="h-[3px] w-[3px] rounded-full bg-[var(--hairline-strong)]" />
                    {isSynced ? t("tool.badges.synced") : t("tool.badges.local")}
                  </span>
                </div>
              </div>
            </div>

            {/* Actions Block */}
            <div className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
              {showPrimaryAction && primaryActionLabelKey && (
                <button
                  type="button"
                  className={cn(
                    "flex h-[28px] items-center justify-center rounded-[8px] px-3 text-[12px] font-[500] shadow-[0_1px_0_var(--hairline)_inset] transition-all duration-150 active:translate-y-[1px]",
                    tool.recommendedAction === "review" 
                      ? "bg-[var(--panel-bg)] text-[var(--ink)] ring-1 ring-[var(--hairline)] hover:bg-[var(--panel-bg-inset)] hover:ring-[var(--hairline-strong)]" 
                      : "bg-[var(--accent)] text-white hover:brightness-110"
                  )}
                  onClick={(e) => { e.stopPropagation(); onPrimaryAction?.(); }}
                >
                  {t(primaryActionLabelKey)}
                </button>
              )}
              
              {showInlineToggle && (
                <div className="flex h-[28px] items-center rounded-[8px] bg-[var(--panel-bg-inset)] px-2 ring-1 ring-[var(--hairline)] transition-all focus-within:ring-[var(--hairline-strong)]">
                  <Switch
                    checked={toggleChecked}
                    onCheckedChange={(checked) => onToggle?.(tool, checked)}
                    disabled={toggleDisabled}
                    className="scale-[0.8] data-[state=checked]:bg-[var(--accent)]"
                  />
                </div>
              )}
              
              {isSynced && onSync && (
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="flex h-[28px] w-[28px] items-center justify-center rounded-[8px] bg-transparent text-[var(--ink-3)] transition-colors hover:bg-[var(--panel-bg-inset)] hover:text-[var(--ink)]"
                        onClick={(e) => { e.stopPropagation(); onSync?.(); }}
                      >
                        <RefreshCw size={14} className={syncLoading ? "animate-spin text-[var(--accent)]" : ""} />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="rounded-[8px] bg-[var(--panel-bg)] text-[11px] font-[500] text-[var(--ink)] ring-1 ring-[var(--hairline-strong)]">
                      Sync
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}

              {showMenu && (
                <GlassDropdownMenu>
                  <GlassDropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex h-[28px] w-[28px] items-center justify-center rounded-[8px] bg-transparent text-[var(--ink-3)] transition-colors hover:bg-[var(--panel-bg-inset)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-[var(--window-bg)]"
                    >
                      <MoreHorizontal size={14} />
                    </button>
                  </GlassDropdownMenuTrigger>
                  <GlassDropdownMenuContent align="end" className="w-[180px] rounded-[12px] bg-[var(--panel-bg)] p-1 text-[12px] shadow-[0_20px_48px_-24px_rgba(0,0,0,0.22)] ring-1 ring-[var(--hairline-strong)]">
                    {showDesktopToggleAction && (
                      <GlassDropdownMenuItem
                        disabled={toggleDisabled}
                        className="rounded-[6px] px-2.5 py-1.5 focus:bg-[var(--accent-soft)] focus:text-[var(--accent-ink)] cursor-pointer"
                        onSelect={(e) => { e.preventDefault(); e.stopPropagation(); onToggle?.(tool, !toggleChecked); }}
                      >
                        {t(toggleActionLabelKey)}
                      </GlassDropdownMenuItem>
                    )}
                    {onEdit && (
                      <GlassDropdownMenuItem
                        className="flex items-center gap-2 rounded-[6px] px-2.5 py-1.5 focus:bg-[var(--panel-bg-inset)] cursor-pointer"
                        onClick={(e) => { e.stopPropagation(); onEdit?.(); }}
                      >
                        <Pencil size={13} className="text-[var(--ink-3)]" />
                        {t("server.actions.edit")}
                      </GlassDropdownMenuItem>
                    )}
                    {onDelete && (
                      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                        <AlertDialogTrigger asChild>
                          <GlassDropdownMenuItem
                            className="flex items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-[var(--danger)] focus:bg-[var(--danger-soft)] focus:text-[var(--danger)] cursor-pointer"
                            onSelect={(e) => { e.preventDefault(); e.stopPropagation(); setConfirmOpen(true); }}
                          >
                            <Trash2 size={13} />
                            {t(deleteActionLabelKey)}
                          </GlassDropdownMenuItem>
                        </AlertDialogTrigger>
                        <AlertDialogContent className="rounded-[18px] bg-[var(--panel-bg)] p-[6px] ring-1 ring-[var(--hairline)] sm:max-w-[420px]">
                          <div className="rounded-[12px] bg-[var(--panel-bg)] ring-1 ring-[var(--hairline)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                            <AlertDialogHeader>
                              <AlertDialogTitle className="text-[17px] font-[600] tracking-[-0.2px] text-[var(--ink)]">
                                {t(`${deleteDialogKeyPrefix}.title`)}
                              </AlertDialogTitle>
                              <AlertDialogDescription className="text-[13px] leading-[1.5] text-[var(--ink-2)]">
                                {t(`${deleteDialogKeyPrefix}.description`, { name: tool.name })}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter className="mt-6 gap-2 sm:space-x-0">
                              <AlertDialogCancel className="h-[32px] rounded-[8px] bg-[var(--panel-bg)] px-3.5 text-[12px] font-[500] text-[var(--ink)] ring-1 ring-[var(--hairline)] hover:bg-[var(--panel-bg-inset)]">
                                {t(`${deleteDialogKeyPrefix}.cancel`)}
                              </AlertDialogCancel>
                              <AlertDialogAction
                                className="h-[32px] rounded-[8px] bg-[var(--danger)] px-3.5 text-[12px] font-[500] text-white shadow-[0_1px_0_rgba(255,255,255,0.2)_inset] hover:brightness-110 border border-[var(--danger-border)]"
                                onClick={() => { onDelete?.(); setConfirmOpen(false); }}
                              >
                                {t(`${deleteDialogKeyPrefix}.confirm`)}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </div>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </GlassDropdownMenuContent>
                </GlassDropdownMenu>
              )}
            </div>
          </div>

          {/* Description */}
          <div className="flex-1 mt-1">
            <p className={cn(
              "text-[var(--ink-2)] font-[400] leading-[1.5] tracking-[0]",
              isCompact ? "line-clamp-1 text-[12px]" : "line-clamp-2 text-[13px]"
            )}>
              {tool.description}
            </p>
            
            {/* Contextual Errors / Messages */}
            <AnimatePresence>
              {(tool.status === "crashed" || tool.status === "error") && tool.error && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <div className="mt-2 rounded-[6px] bg-[var(--danger-soft)] px-2.5 py-1.5 border border-[var(--danger-border)]">
                    <span className="text-[11px] font-mono text-[var(--danger)] line-clamp-2">
                      <strong className="font-[600]">{t("tool.labels.error")}:</strong> {tool.error}
                    </span>
                  </div>
                </motion.div>
              )}
              {tool.indexStatus === "missing" && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <div className="mt-2 rounded-[6px] bg-[var(--accent-soft)] px-2.5 py-1.5 border border-[var(--accent-border)]">
                    <span className="text-[11px] text-[var(--accent-ink)]">
                      <strong className="font-[600]">{t("tool.labels.index")}:</strong> {t(indexLabelKey)}
                    </span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Capabilities Footer */}
          {tool.capabilities.length > 0 && !isCompact && (
            <div className="mt-auto flex flex-wrap items-center gap-1.5 border-t border-[var(--hairline)] pt-3">
              {tool.capabilities.map((cap) => (
                <span
                  key={cap}
                  className="rounded-[4px] border border-[var(--hairline)] bg-[var(--panel-bg-inset)] px-1.5 py-[2px] font-mono text-[10px] tracking-[0.2px] text-[var(--ink-3)] uppercase"
                >
                  {cap}
                </span>
              ))}
            </div>
          )}
        </div>
      </Card>
    </motion.div>
  )
}
