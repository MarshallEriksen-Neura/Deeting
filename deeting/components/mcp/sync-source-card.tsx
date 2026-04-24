"use client"

import { RefreshCw, Server, Globe, Folder, ShieldCheck, Lock, AlertTriangle } from "lucide-react"
import { GlassButton } from "@/components/ui/common/glass-button"
import { GlassCard } from "@/components/ui/common/glass-card"
import { Badge } from "@/components/ui/shadcn/badge"
import { cn } from "@/lib/utils"
import { MCPSource } from "@/types/mcp"
import { useTranslations } from "next-intl"

interface SyncSourceCardProps {
  source: MCPSource
  onSync?: () => void
}

const sourceTheme = {
  modelscope: {
    bar: "from-[var(--accent-strong)] via-[var(--accent-ink)] to-[var(--info)]",
    iconBg: "bg-[var(--accent-soft)] border-[var(--accent-border)]",
    iconText: "text-[var(--accent-strong)]",
  },
  github: {
    bar: "from-[var(--ink-3)] via-[var(--ink-2)] to-[var(--ink)]",
    iconBg: "bg-[var(--panel-bg-inset)] border-[var(--hairline)]",
    iconText: "text-[var(--ink-2)]",
  },
  url: {
    bar: "from-[var(--ok)] via-[var(--info)] to-[var(--accent-strong)]",
    iconBg: "bg-[var(--ok-soft)] border-[var(--ok-border)]",
    iconText: "text-[var(--ok)]",
  },
  local: {
    bar: "from-[var(--ink-4)] via-[var(--ink-3)] to-[var(--ink-2)]",
    iconBg: "bg-[var(--panel-bg-inset)] border-[var(--hairline)]",
    iconText: "text-[var(--ink-2)]",
  },
} as const

const TrustBadge = ({ trustLevel }: { trustLevel?: MCPSource["trustLevel"] }) => {
  const t = useTranslations("mcp")
  switch (trustLevel) {
    case "official":
      return (
        <Badge
          variant="secondary"
          className="h-5 gap-1 border-[var(--info-border)] bg-[var(--info-soft)] px-1.5 text-[10px] text-[var(--info)] shadow-sm hover:bg-[var(--info-soft)]"
        >
          <ShieldCheck size={10} /> {t("source.trust.official")}
        </Badge>
      )
    case "community":
      return (
        <Badge
          variant="secondary"
          className="h-5 gap-1 border-[var(--warn-border)] bg-[var(--warn-soft)] px-1.5 text-[10px] text-[var(--warn)] shadow-sm hover:bg-[var(--warn-soft)]"
        >
          <AlertTriangle size={10} /> {t("source.trust.community")}
        </Badge>
      )
    case "private":
      return (
        <Badge
          variant="secondary"
          className="h-5 gap-1 border-[var(--hairline)] bg-[var(--panel-bg-inset)] px-1.5 text-[10px] text-[var(--ink-2)] shadow-sm hover:bg-[var(--panel-bg-inset)]"
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
    case "local":
      return <Server size={18} strokeWidth={2} />
    default:
      return <Folder size={18} strokeWidth={2} />
  }
}

export function SyncSourceCard({ source, onSync }: SyncSourceCardProps) {
  const t = useTranslations("mcp")
  const isModelScope = source.type === "modelscope"
  const isDraft = source.status === "draft" || source.serverType === "stdio"
  const isRemote = isModelScope || source.type === "github" || source.type === "url"
  const theme = sourceTheme[source.type] || sourceTheme.local

  return (
    <GlassCard
      blur="lg"
      theme={isModelScope ? "primary" : "default"}
      hover="lift"
      padding="none"
      className={cn(
        "group overflow-hidden rounded-[var(--r-18)] border-[var(--hairline)] bg-[var(--panel-bg)] shadow-[0_20px_40px_-28px_rgba(0,0,0,0.38)] transition-all duration-300",
        isModelScope && "ring-1 ring-[var(--accent-strong)]/15"
      )}
    >
      {/* Source type accent bar */}
      <div
        className={cn(
          "h-[2px] rounded-t-[var(--r-18)] bg-gradient-to-r transition-all duration-500",
          theme.bar,
          isDraft && "opacity-30"
        )}
      />

      <div className="flex flex-col gap-3 p-4">
        {/* Header: Icon + Info + Trust Badge */}
        <div className="flex items-start gap-3">
          {/* Icon with source-type tint */}
          <div
            className={cn(
              "flex size-11 shrink-0 items-center justify-center rounded-[var(--r-10)] border backdrop-blur-sm transition-all duration-300",
              theme.iconBg
            )}
          >
            <span className={cn("transition-colors duration-300", theme.iconText)}>
              <SourceIcon type={source.type} />
            </span>
          </div>

          {/* Name + URL */}
          <div className="flex-1 min-w-0">
            <h3 className="flex items-center gap-2 truncate text-[15px] font-semibold tracking-[-0.02em] text-[var(--ink)]">
              {source.name}
            </h3>
            <p
              className="mt-1 max-w-full truncate font-mono text-[11px] text-[var(--ink-3)]"
              title={source.pathOrUrl}
            >
              {source.pathOrUrl}
            </p>
          </div>

          <TrustBadge trustLevel={source.trustLevel} />
        </div>

        {/* Footer: Status + Sync button */}
        <div className="flex items-center justify-between rounded-[var(--r-10)] border border-[var(--hairline)] bg-[var(--panel-bg-inset)] px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-xs text-[var(--ink-2)]">
            {isDraft ? (
              <span className="flex items-center gap-1.5 text-[var(--warn)]">
                <AlertTriangle size={12} />
                {t("source.status.draft")}
              </span>
            ) : isRemote ? (
              <span className="flex items-center gap-1.5">
                <Globe size={12} className="text-[var(--ink-3)]" />
                <span className={cn(source.status === "syncing" && "animate-pulse")}>
                  {source.status === "syncing"
                    ? t("source.status.syncing")
                    : source.lastSynced || t("source.status.autoSync")}
                </span>
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--ok)] opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[var(--ok)] shadow-sm" />
                </span>
                {t("source.status.activeLocal")}
              </span>
            )}
          </div>

          <GlassButton
            size="icon-sm"
            variant="ghost"
            className={cn(
              "text-[var(--ink-3)] transition-all hover:text-[var(--ink)]",
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
