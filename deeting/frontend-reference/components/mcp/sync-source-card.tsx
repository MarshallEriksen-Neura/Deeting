"use client"

import { RefreshCw, Server, Globe, Folder, ShieldCheck, Lock, AlertTriangle } from "lucide-react"
import { GlassButton } from "@/ui/common/glass-button"
import { GlassCard } from "@/ui/common/glass-card"
import { Badge } from "@/ui/shadcn/badge"
import { cn } from "@/lib/utils"
import { MCPSource } from "@/types/mcp"
import { useTranslations } from "next-intl"

interface SyncSourceCardProps {
  source: MCPSource
  onSync?: () => void
}

// Source type visual theme
const sourceTheme = {
  modelscope: {
    bar: "from-violet-400 via-purple-500 to-indigo-500",
    iconBg: "bg-gradient-to-br from-violet-500/12 to-indigo-500/8 border-violet-400/25",
    iconText: "text-violet-600",
  },
  cloud: {
    bar: "from-blue-400 via-cyan-500 to-teal-500",
    iconBg: "bg-gradient-to-br from-blue-500/12 to-cyan-500/8 border-blue-400/25",
    iconText: "text-blue-600",
  },
  github: {
    bar: "from-gray-500 via-gray-600 to-slate-600",
    iconBg: "bg-gradient-to-br from-gray-500/12 to-slate-500/8 border-gray-400/25",
    iconText: "text-gray-700",
  },
  url: {
    bar: "from-emerald-400 via-emerald-500 to-teal-500",
    iconBg: "bg-gradient-to-br from-emerald-500/12 to-teal-500/8 border-emerald-400/25",
    iconText: "text-emerald-600",
  },
  local: {
    bar: "from-gray-300 via-gray-400 to-slate-400",
    iconBg: "bg-white/40 border-white/20",
    iconText: "text-gray-500",
  },
} as const

const TrustBadge = ({ trustLevel }: { trustLevel?: MCPSource["trustLevel"] }) => {
  const t = useTranslations("mcp")
  switch (trustLevel) {
    case "official":
      return (
        <Badge
          variant="secondary"
          className="h-5 px-1.5 text-[10px] bg-gradient-to-r from-blue-50 to-cyan-50 text-blue-700 hover:bg-blue-100 border-blue-200/50 gap-1 shadow-sm"
        >
          <ShieldCheck size={10} /> {t("source.trust.official")}
        </Badge>
      )
    case "community":
      return (
        <Badge
          variant="secondary"
          className="h-5 px-1.5 text-[10px] bg-gradient-to-r from-amber-50 to-yellow-50 text-amber-700 hover:bg-amber-100 border-amber-200/50 gap-1 shadow-sm"
        >
          <AlertTriangle size={10} /> {t("source.trust.community")}
        </Badge>
      )
    case "private":
      return (
        <Badge
          variant="secondary"
          className="h-5 px-1.5 text-[10px] bg-gradient-to-r from-gray-50 to-slate-50 text-gray-600 hover:bg-gray-200 border-gray-200/50 gap-1 shadow-sm"
        >
          <Lock size={10} /> {t("source.trust.private")}
        </Badge>
      )
    default:
      return null
  }
}

const SourceIcon = ({ type }: { type: MCPSource["type"] }) => {
  switch (type) {
    case "modelscope":
      return <span className="text-xs font-bold">MS</span>
    case "cloud":
      return <Globe size={18} strokeWidth={2} />
    case "local":
      return <Server size={18} strokeWidth={2} />
    default:
      return <Folder size={18} strokeWidth={2} />
  }
}

export function SyncSourceCard({ source, onSync }: SyncSourceCardProps) {
  const t = useTranslations("mcp")
  const isModelScope = source.type === "modelscope"
  const isCloud = source.type === "cloud"
  const isDraft = source.status === "draft" || source.serverType === "stdio"
  const isRemote = isModelScope || isCloud || source.type === "github" || source.type === "url"
  const theme = sourceTheme[source.type] || sourceTheme.local

  return (
    <GlassCard
      blur="lg"
      theme={isModelScope || isCloud ? "primary" : "default"}
      hover="lift"
      padding="none"
      className={cn(
        "group transition-all duration-300",
        (isModelScope || isCloud) && "ring-1 ring-[var(--primary)]/20"
      )}
    >
      {/* Source type accent bar */}
      <div
        className={cn(
          "h-[2px] rounded-t-2xl bg-gradient-to-r transition-all duration-500",
          theme.bar,
          isDraft && "opacity-30"
        )}
      />

      <div className="p-5 flex flex-col gap-3">
        {/* Header: Icon + Info + Trust Badge */}
        <div className="flex items-start gap-3">
          {/* Icon with source-type tint */}
          <div
            className={cn(
              "flex size-10 items-center justify-center rounded-xl border backdrop-blur-sm transition-all duration-300 shrink-0",
              theme.iconBg
            )}
          >
            <span className={cn("transition-colors duration-300", theme.iconText)}>
              <SourceIcon type={source.type} />
            </span>
          </div>

          {/* Name + URL */}
          <div className="flex-1 min-w-0">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--foreground)] truncate">
              {source.name}
            </h3>
            <p
              className="mt-0.5 max-w-full truncate font-mono text-[10px] text-[var(--muted)]"
              title={source.pathOrUrl}
            >
              {source.pathOrUrl}
            </p>
          </div>

          <TrustBadge trustLevel={source.trustLevel} />
        </div>

        {/* Footer: Status + Sync button */}
        <div className="flex items-center justify-between pt-2.5 border-t border-[var(--border)]/20">
          <div className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
            {isDraft ? (
              <span className="flex items-center gap-1.5 text-amber-600/80">
                <AlertTriangle size={12} />
                {t("source.status.draft")}
              </span>
            ) : isRemote ? (
              <span className="flex items-center gap-1.5">
                <Globe size={12} className="text-[var(--muted)]" />
                <span className={cn(source.status === "syncing" && "animate-pulse")}>
                  {source.status === "syncing"
                    ? t("source.status.syncing")
                    : source.lastSynced || t("source.status.autoSync")}
                </span>
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500 shadow-sm shadow-emerald-500/50" />
                </span>
                {t("source.status.activeLocal")}
              </span>
            )}
          </div>

          <GlassButton
            size="icon-sm"
            variant="ghost"
            className={cn(
              "text-[var(--muted)] hover:text-[var(--foreground)] transition-all",
              source.status !== "syncing" && "opacity-0 group-hover:opacity-100"
            )}
            onClick={() => onSync?.()}
            disabled={source.status === "syncing" || isDraft}
          >
            <RefreshCw size={14} className={cn(source.status === "syncing" && "animate-spin")} />
          </GlassButton>
        </div>
      </div>
    </GlassCard>
  )
}
