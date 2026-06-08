"use client"

import { memo, useCallback, useMemo, useReducer } from "react"
import { ChevronDown } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"

import { useChatStore } from "@/store/chat-store"
import { useChatRuntimeStore } from "@/store/chat-runtime-store"
import { useShallow } from "zustand/react/shallow"
import { AssistantActivityTimeline } from "@/components/chat/messages/ai-response-bubble/assistant-activity-timeline"
import type { ActivityTimelineBlock } from "@/lib/chat/message-protocol"
import { cn } from "@/lib/utils"

function useActiveTimeline(): { block: ActivityTimelineBlock | null; isActive: boolean } {
  const { messages } = useChatStore(useShallow((s) => ({ messages: s.messages })))
  const activeMessageId = useChatRuntimeStore((s) => s.activeMessageId)

  return useMemo(() => {
    // Only show when there is an active (streaming) message
    if (!activeMessageId) return { block: null, isActive: false }
    const msg = messages.find((m) => m.id === activeMessageId)
    if (!msg?.blocks) return { block: null, isActive: false }
    const block = msg.blocks.find((b) => b.type === "activity_timeline") as
      | ActivityTimelineBlock
      | undefined
    return { block: block ?? null, isActive: true }
  }, [messages, activeMessageId])
}

export const HudActivityBar = memo(function HudActivityBar() {
  const { block, isActive } = useActiveTimeline()
  const [collapsed, toggleCollapsed] = useReducer((s: boolean) => !s, false)

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    toggleCollapsed()
  }, [])

  const visible = Boolean(block)

  return (
    <AnimatePresence>
      {visible && block && (
        <motion.div
          key="hud-activity-bar"
          initial={{ opacity: 0, y: -12, scale: 0.96, filter: "blur(6px)" }}
          animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -8, scale: 0.96, filter: "blur(4px)" }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          className={cn(
            "mt-2 w-[min(calc(100vw-48px),340px)]",
            "rounded-2xl border border-white/60 dark:border-white/8",
            "bg-white/72 dark:bg-black/42 backdrop-blur-2xl",
            "shadow-[0_8px_24px_-8px_rgba(15,23,42,0.18)] dark:shadow-[0_8px_24px_-8px_rgba(0,0,0,0.5)]",
            "overflow-hidden",
          )}
        >
          {/* Header row — click to collapse */}
          <button
            type="button"
            onClick={handleToggle}
            className="flex w-full items-center justify-between px-3 py-2 text-left"
          >
            <span className="flex items-center gap-1.5">
              {/* breathing dot */}
              {isActive && (
                <span className="relative flex h-[7px] w-[7px]">
                  <motion.span
                    className="absolute inset-0 rounded-full bg-[var(--accent,#6d5cff)]/20"
                    animate={{ scale: [1, 1.9, 1], opacity: [0.5, 0, 0.5] }}
                    transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                  />
                  <motion.span
                    className="relative inline-flex h-full w-full rounded-full bg-[var(--accent,#6d5cff)]"
                    animate={{ opacity: [0.6, 1, 0.6] }}
                    transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                  />
                </span>
              )}
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-white/45">
                调用链
              </span>
            </span>
            <motion.div
              animate={{ rotate: collapsed ? -90 : 0 }}
              transition={{ duration: 0.22, ease: [0.25, 0.1, 0.25, 1] }}
            >
              <ChevronDown size={13} className="text-slate-400 dark:text-white/30" />
            </motion.div>
          </button>

          {/* Collapsible body */}
          <AnimatePresence initial={false}>
            {!collapsed && (
              <motion.div
                key="body"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.28, ease: [0.25, 0.1, 0.25, 1] }}
                style={{ overflow: "hidden" }}
              >
                <div className="px-3 pb-3">
                  <AssistantActivityTimeline block={block} isActive={isActive} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  )
})
