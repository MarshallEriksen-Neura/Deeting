"use client"

import { useTranslations } from "next-intl"
import { HardDrive, Database, FileText, FolderOpen } from "lucide-react"
import { GlassCard } from "@/components/ui/glass-card"
import type { KnowledgeStats } from "@/types/knowledge"

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

interface KnowledgeStatsBarProps {
  stats: KnowledgeStats
}

export function KnowledgeStatsBar({ stats }: KnowledgeStatsBarProps) {
  const t = useTranslations("knowledge")
  const hasManagedTotal = typeof stats.totalBytes === "number" && stats.totalBytes > 0

  return (
    <GlassCard padding="sm" hover="none">
      <div className="flex flex-wrap items-center gap-6">
        {/* Storage usage */}
        <div className="flex items-center gap-3 flex-1 min-w-[200px]">
          <HardDrive className="h-5 w-5 text-[var(--primary)] shrink-0" />
          <div className="flex-1 space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--muted)]">{t("stats.usedSpace")}</span>
              <span className="text-[var(--foreground)] font-medium">
                {formatBytes(stats.usedBytes)}
                {hasManagedTotal ? ` / ${formatBytes(stats.totalBytes!)}` : ""}
              </span>
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="hidden md:block h-8 w-px bg-[var(--border)]/50" />

        {/* Vectors */}
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-emerald-500" />
          <div className="text-xs">
            <span className="text-[var(--muted)]">{t("stats.vectors")}</span>
            <span className="ml-1.5 text-[var(--foreground)] font-semibold">
              {stats.totalVectors.toLocaleString()}
            </span>
          </div>
        </div>

        {/* Divider */}
        <div className="hidden md:block h-8 w-px bg-[var(--border)]/50" />

        {/* Files */}
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-blue-500" />
          <div className="text-xs">
            <span className="text-[var(--muted)]">{t("stats.files")}</span>
            <span className="ml-1.5 text-[var(--foreground)] font-semibold">{stats.totalFiles}</span>
          </div>
        </div>

        {/* Divider */}
        <div className="hidden md:block h-8 w-px bg-[var(--border)]/50" />

        {/* Folders */}
        <div className="flex items-center gap-2">
          <FolderOpen className="h-4 w-4 text-amber-500" />
          <div className="text-xs">
            <span className="text-[var(--muted)]">{t("stats.folders")}</span>
            <span className="ml-1.5 text-[var(--foreground)] font-semibold">{stats.totalFolders}</span>
          </div>
        </div>
      </div>
    </GlassCard>
  )
}
