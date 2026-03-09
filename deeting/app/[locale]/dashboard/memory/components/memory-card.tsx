"use client"

import { memo } from "react"
import { useTranslations } from "next-intl"
import { Trash2, Edit2, Brain, History, Clock } from "lucide-react"
import { GlassButton } from "@/components/ui/glass-button"
import { GlassCard } from "@/components/ui/glass-card"
import type { MemoryItem } from "@/types/memory"

const CATEGORY_COLORS: Record<string, string> = {
  fact: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  preference: "bg-violet-500/15 text-violet-400 border-violet-500/30",
  event: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  relation: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
}

interface MemoryCardProps {
  item: MemoryItem
  onEdit: (item: MemoryItem) => void
  onDelete: (id: string) => void
  onHistory?: (id: string) => void
}

export const MemoryCard = memo(function MemoryCard({
  item,
  onEdit,
  onDelete,
  onHistory,
}: MemoryCardProps) {
  const t = useTranslations("memory")
  const source = item.source || item.payload?.source || item.payload?.plugin_id || item.payload?.type || "extracted_fact"
  const isExtracted = source === "extracted_fact" || source === "auto_extraction"
  const sourceLabel = isExtracted
    ? t("source.autoExtracted")
    : (source.split("/").pop() ?? t("source.unknown"))

  const category = item.category ?? (typeof item.payload?.category === "string" ? item.payload.category : undefined)
  const rawTags = item.tags ?? item.payload?.tags
  const tags = Array.isArray(rawTags)
    ? rawTags.filter((tag): tag is string => typeof tag === "string")
    : undefined
  const vitality = item.vitality ?? (typeof item.payload?.vitality === "number" ? item.payload.vitality : undefined)
  const memoryTier = item.memory_tier ?? (typeof item.payload?.memory_tier === "string" ? item.payload.memory_tier : null)
  const recallWhen = item.recall_when ?? (typeof item.payload?.recall_when === "string" ? item.payload.recall_when : null)
  const isCore = item.is_core ?? (typeof item.payload?.is_core === "boolean" ? item.payload.is_core : false)
  const isBoot = item.is_boot ?? (typeof item.payload?.is_boot === "boolean" ? item.payload.is_boot : false)
  const categoryColor = category ? CATEGORY_COLORS[category] ?? CATEGORY_COLORS.fact : null
  const categoryLabel = category
    ? {
        fact: t("filter.fact"),
        preference: t("filter.preference"),
        event: t("filter.event"),
        relation: t("filter.relation"),
      }[category] ?? category
    : null

  return (
    <GlassCard className="p-5 flex flex-col justify-between group h-full transition-all hover:ring-1 hover:ring-blue-500/30">
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-blue-50/50 dark:bg-blue-900/20 border border-blue-100/50 dark:border-blue-800/30">
              {isExtracted ? (
                <Brain className="w-3 h-3 text-blue-500" />
              ) : (
                <Clock className="w-3 h-3 text-purple-500" />
              )}
              <span className="text-[10px] font-medium text-blue-700 dark:text-blue-300 uppercase tracking-wider">
                {sourceLabel}
              </span>
            </div>
            {categoryColor && category && (
              <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border ${categoryColor}`}>
                {categoryLabel}
              </span>
            )}
            {isBoot && (
              <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border bg-amber-500/15 text-amber-400 border-amber-500/30">
                {t("tier.boot")}
              </span>
            )}
            {isCore && !isBoot && (
              <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30">
                {t("tier.core")}
              </span>
            )}
            {memoryTier && memoryTier !== "core" && (
              <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border bg-white/10 text-gray-300 border-white/10">
                {t(`tier.${memoryTier}` as never, { default: memoryTier })}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {item.score != null && (
              <span className="text-[10px] text-gray-400">
                {item.score.toFixed(2)}
              </span>
            )}
          </div>
        </div>

        <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300 whitespace-pre-wrap line-clamp-6">
          {item.content}
        </p>

        {/* Tags */}
        {tags && tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.slice(0, 4).map((tag) => (
              <span
                key={tag}
                className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-white/5 text-gray-500 dark:text-gray-400 border border-gray-200/50 dark:border-white/5"
              >
                {tag}
              </span>
            ))}
            {tags.length > 4 && (
              <span className="text-[10px] text-gray-400">+{tags.length - 4}</span>
            )}
          </div>
        )}

        {recallWhen && (
          <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wider text-gray-400">{t("fields.recallWhen")}</p>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-300 line-clamp-2">{recallWhen}</p>
          </div>
        )}

        {/* Vitality bar */}
        {vitality != null && (
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1 rounded-full bg-gray-200/50 dark:bg-white/5 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-500"
                style={{ width: `${Math.round(vitality * 100)}%` }}
              />
            </div>
            <span className="text-[9px] text-gray-400 tabular-nums w-7 text-right">
              {Math.round(vitality * 100)}%
            </span>
          </div>
        )}
      </div>

      <div className="flex justify-end mt-6 pt-4 border-t border-gray-100 dark:border-white/5 opacity-0 group-hover:opacity-100 transition-all duration-200 translate-y-2 group-hover:translate-y-0">
        <div className="flex items-center gap-1">
          {onHistory && (
            <GlassButton
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 hover:bg-amber-50 dark:hover:bg-amber-900/20"
              onClick={() => onHistory(item.id)}
              title={t("actions.history")}
            >
              <History className="w-3.5 h-3.5" />
            </GlassButton>
          )}
          <GlassButton
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 hover:bg-blue-50 dark:hover:bg-blue-900/20"
            onClick={() => onEdit(item)}
            title={t("actions.edit")}
          >
            <Edit2 className="w-3.5 h-3.5" />
          </GlassButton>
          <GlassButton
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
            onClick={() => onDelete(item.id)}
            title={t("actions.delete")}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </GlassButton>
        </div>
      </div>
    </GlassCard>
  )
})
