"use client"

import { memo } from "react"
import { useTranslations } from "next-intl"
import { Trash2, Edit2, Brain, History } from "lucide-react"
import { GlassButton } from "@/components/ui/glass-button"
import { GlassCard } from "@/components/ui/glass-card"
import type { MemoryItem } from "@/types/memory"

interface MemoryCardProps {
  item: MemoryItem
  onEdit: (item: MemoryItem) => void
  onDelete: (id: string) => void
}

export const MemoryCard = memo(function MemoryCard({
  item,
  onEdit,
  onDelete,
}: MemoryCardProps) {
  const t = useTranslations("memory")
  const source = item.payload?.plugin_id || "extracted_fact"
  const isExtracted = source === "extracted_fact"

  return (
    <GlassCard className="p-5 flex flex-col justify-between group h-full transition-all hover:ring-1 hover:ring-blue-500/30">
      <div className="space-y-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2 px-2 py-1 rounded-full bg-blue-50/50 dark:bg-blue-900/20 border border-blue-100/50 dark:border-blue-800/30">
            {isExtracted ? (
              <Brain className="w-3 h-3 text-blue-500" />
            ) : (
              <History className="w-3 h-3 text-purple-500" />
            )}
            <span className="text-[10px] font-medium text-blue-700 dark:text-blue-300 uppercase tracking-wider">
              {isExtracted ? "Auto-Extracted" : source.split("/").pop()}
            </span>
          </div>
          {item.score && (
            <span className="text-[10px] text-gray-400">
              Score: {item.score.toFixed(2)}
            </span>
          )}
        </div>

        <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300 whitespace-pre-wrap line-clamp-6">
          {item.content}
        </p>
      </div>

      <div className="flex justify-end mt-6 pt-4 border-t border-gray-100 dark:border-white/5 opacity-0 group-hover:opacity-100 transition-all duration-200 translate-y-2 group-hover:translate-y-0">
        <div className="flex items-center gap-1">
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
