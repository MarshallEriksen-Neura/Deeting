"use client"

import { RefreshCw, Server, Globe, Folder, ShieldCheck, Lock, AlertTriangle } from "lucide-react"
import { GlassButton } from "@/components/ui/glass-button"
import { GlassCard } from "@/components/ui/glass-card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { MCPSource } from "@/types/mcp"

interface SyncSourceCardProps {
  source: MCPSource
  onSync?: (id: string) => void
}

const TrustBadge = ({ trustLevel }: { trustLevel?: MCPSource['trustLevel'] }) => {
    switch(trustLevel) {
        case 'official':
            return <Badge variant="secondary" className="h-6 px-2 bg-gradient-to-r from-blue-50 to-cyan-50 text-blue-700 hover:bg-blue-100 border-blue-200/50 gap-1.5 shadow-sm"><ShieldCheck size={11} /> Official</Badge>
        case 'community':
            return <Badge variant="secondary" className="h-6 px-2 bg-gradient-to-r from-amber-50 to-yellow-50 text-amber-700 hover:bg-amber-100 border-amber-200/50 gap-1.5 shadow-sm"><AlertTriangle size={11} /> Community</Badge>
        case 'private':
            return <Badge variant="secondary" className="h-6 px-2 bg-gradient-to-r from-gray-50 to-slate-50 text-gray-600 hover:bg-gray-200 border-gray-200/50 gap-1.5 shadow-sm"><Lock size={11} /> Private</Badge>
        default:
            return null
    }
}

export function SyncSourceCard({ source, onSync }: SyncSourceCardProps) {
  const isModelScope = source.type === "modelscope"
  const isLocal = source.type === "local"

  return (
    <GlassCard
      blur="lg"
      theme={isModelScope ? "primary" : "default"}
      hover="lift"
      padding="none"
      className={cn(
        "transition-all duration-300",
        isModelScope && "ring-1 ring-[var(--primary)]/20"
      )}
    >
      <div className="p-5 flex flex-col gap-3">
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "flex size-10 items-center justify-center rounded-xl border shadow-sm",
                isModelScope
                  ? "bg-[var(--primary)]/10 border-[var(--primary)]/20 text-[var(--primary)]"
                  : "bg-[var(--surface)] border-[var(--border)]/50 text-[var(--muted)]"
              )}
            >
              {isModelScope ? (
                <span className="text-xs font-bold">MS</span>
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
            {isModelScope ? (
              <>
                <Globe size={12} />
                <span className={cn(source.status === "syncing" && "animate-pulse")}>
                  {source.status === "syncing" ? "Syncing..." : source.lastSynced || "Auto-Sync On"}
                </span>
              </>
            ) : (
              <span className="flex items-center gap-1.5">
                <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" />{" "}
                Active Local
              </span>
            )}
          </div>

          {source.type !== "local" && (
            <GlassButton
              size="icon-sm"
              variant="ghost"
              className="text-[var(--muted)] hover:text-[var(--foreground)]"
              onClick={() => onSync?.(source.id)}
              disabled={source.status === "syncing"}
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