"use client"

import { RefreshCw, Server, Globe, Folder, ShieldCheck, Lock, AlertTriangle } from "lucide-react"
import { GlassButton } from "@/components/ui/glass-button"
import { GlassCard } from "@/components/ui/glass-card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { MCPSource } from "@/types/mcp"
import { useTranslations } from "next-intl"

interface SyncSourceCardProps {
  source: MCPSource
  onSync?: () => void
}

const TrustBadge = ({ trustLevel }: { trustLevel?: MCPSource['trustLevel'] }) => {
    const t = useTranslations("mcp")
    switch(trustLevel) {
        case 'official':
            return <Badge variant="secondary" className="h-6 px-2 bg-gradient-to-r from-blue-50 to-cyan-50 text-blue-700 hover:bg-blue-100 border-blue-200/50 gap-1.5 shadow-sm"><ShieldCheck size={11} /> {t("source.trust.official")}</Badge>
        case 'community':
            return <Badge variant="secondary" className="h-6 px-2 bg-gradient-to-r from-amber-50 to-yellow-50 text-amber-700 hover:bg-amber-100 border-amber-200/50 gap-1.5 shadow-sm"><AlertTriangle size={11} /> {t("source.trust.community")}</Badge>
        case 'private':
            return <Badge variant="secondary" className="h-6 px-2 bg-gradient-to-r from-gray-50 to-slate-50 text-gray-600 hover:bg-gray-200 border-gray-200/50 gap-1.5 shadow-sm"><Lock size={11} /> {t("source.trust.private")}</Badge>
        default:
            return null
    }
}

export function SyncSourceCard({ source, onSync }: SyncSourceCardProps) {
  const t = useTranslations("mcp")
  const isModelScope = source.type === "modelscope"
  const isCloud = source.type === "cloud"
  const isLocal = source.type === "local"
  const isDraft = source.status === "draft" || source.serverType === "stdio"

  return (
    <GlassCard
      blur="lg"
      theme={isModelScope || isCloud ? "primary" : "default"}
      hover="lift"
      padding="none"
      className={cn(
        "transition-all duration-300",
        (isModelScope || isCloud) && "ring-1 ring-[var(--primary)]/20"
      )}
    >
      <div className="p-5 flex flex-col gap-3">
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "flex size-10 items-center justify-center rounded-xl border shadow-sm",
                isModelScope || isCloud
                  ? "bg-[var(--primary)]/10 border-[var(--primary)]/20 text-[var(--primary)]"
                  : "bg-[var(--surface)] border-[var(--border)]/50 text-[var(--muted)]"
              )}
            >
              {isModelScope ? (
                <span className="text-xs font-bold">MS</span>
              ) : isCloud ? (
                <Globe size={18} />
              ) : isLocal ? (
                <Server size={18} />
              ) : (
                <Folder size={18} />
              )}
            </div>
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
                {source.name}
              </h3>
              <p
                className="mt-0.5 max-w-[150px] truncate font-mono text-[10px] text-[var(--muted)]"
                title={source.pathOrUrl}
              >
                {source.pathOrUrl}
              </p>
            </div>
          </div>

          <TrustBadge trustLevel={source.trustLevel} />
        </div>

          <div className="flex items-center justify-between border-t border-[var(--border)]/30 pt-2">
          <div className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
          {isDraft ? (
            <span className="flex items-center gap-1.5 text-[var(--muted)]">
              <AlertTriangle size={12} />
              {t("source.status.draft")}
            </span>
          ) : isModelScope || isCloud || source.type === "github" || source.type === "url" ? (
            <>
              <Globe size={12} />
              <span className={cn(source.status === "syncing" && "animate-pulse")}>
                {source.status === "syncing" ? t("source.status.syncing") : source.lastSynced || t("source.status.autoSync")}
              </span>
            </>
          ) : (
            <span className="flex items-center gap-1.5">
              <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" />{" "}
              {t("source.status.activeLocal")}
            </span>
          )}
          </div>

          {source.type !== "local" && (
            <GlassButton
              size="icon-sm"
              variant="ghost"
              className="text-[var(--muted)] hover:text-[var(--foreground)]"
              onClick={() => onSync?.()}
              disabled={source.status === "syncing" || isDraft}
            >
              <RefreshCw
                size={14}
                className={cn(source.status === "syncing" && "animate-spin")}
              />
            </GlassButton>
          )}
        </div>
      </div>
    </GlassCard>
  )
}
