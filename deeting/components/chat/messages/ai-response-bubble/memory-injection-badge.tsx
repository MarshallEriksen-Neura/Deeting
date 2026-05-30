"use client"

import { useState, memo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Brain } from "lucide-react"
import { cn } from "@/lib/utils"
import type { MemoryInjectionItem } from "@/lib/chat/status-detail"

interface MemoryInjectionBadgeProps {
  items: MemoryInjectionItem[]
}

const CATEGORY_STYLES: Record<string, string> = {
  fact: "bg-emerald-500/10 text-emerald-400",
  preference: "bg-amber-500/10 text-amber-400",
  event: "bg-blue-500/10 text-blue-400",
  relation: "bg-purple-500/10 text-purple-400",
}

function truncateContent(content: string, maxLen = 80): string {
  if (content.length <= maxLen) return content
  return content.slice(0, maxLen).trimEnd() + "…"
}

export const MemoryInjectionBadge = memo<MemoryInjectionBadgeProps>(
  function MemoryInjectionBadge({ items }) {
    const [expanded, setExpanded] = useState(false)

    if (!items.length) return null

    return (
      <div className="flex flex-col gap-1.5 self-start">
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className={cn(
            "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium tracking-wide",
            "transition-all duration-200 cursor-pointer select-none",
            "bg-[#6d5cff]/8 dark:bg-[var(--accent)]/8",
            "border border-[#6d5cff]/15 dark:border-[var(--accent)]/15",
            "text-[#6d5cff] dark:text-[var(--accent)]",
            "hover:bg-[#6d5cff]/14 dark:hover:bg-[var(--accent)]/14",
            "hover:border-[#6d5cff]/30 dark:hover:border-[var(--accent)]/30",
          )}
        >
          <Brain className="w-3 h-3 opacity-70" />
          <span>remember · {items.length} {items.length === 1 ? "item" : "items"}</span>
        </button>

        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden"
            >
              <div className="flex flex-col gap-1 pt-1">
                {items.map((item) => (
                  <div
                    key={item.id || item.content.slice(0, 30)}
                    className={cn(
                      "flex items-start gap-2 px-2.5 py-2 rounded-lg",
                      "bg-[#6d5cff]/4 dark:bg-[var(--accent)]/4",
                      "border border-[#6d5cff]/8 dark:border-[var(--accent)]/8",
                      "hover:border-[#6d5cff]/20 dark:hover:border-[var(--accent)]/20",
                      "transition-colors group",
                    )}
                  >
                    {(item.category || item.isBoot || item.isCore) && (
                      <span
                        className={cn(
                          "shrink-0 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider",
                          item.isBoot
                            ? "bg-indigo-500/10 text-indigo-400"
                            : item.isCore
                              ? "bg-[#6d5cff]/10 text-[#6d5cff]"
                              : item.category && CATEGORY_STYLES[item.category]
                                ? CATEGORY_STYLES[item.category]
                                : "bg-zinc-500/10 text-zinc-400",
                        )}
                      >
                        {item.isBoot ? "boot" : item.isCore ? "core" : item.category}
                      </span>
                    )}
                    <span className="text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500 flex-1 min-w-0">
                      {truncateContent(item.content)}
                    </span>
                    {item.id && (
                      <span className="shrink-0 text-[9px] font-mono text-zinc-600 dark:text-zinc-700 opacity-0 group-hover:opacity-100 transition-opacity">
                        {item.id.slice(0, 8)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    )
  },
)
