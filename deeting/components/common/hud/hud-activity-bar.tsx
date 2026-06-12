"use client"

import { memo, useMemo, useState } from "react"
import { ChevronDown } from "lucide-react"
import { motion } from "framer-motion"

import { useChatStore } from "@/store/chat-store"
import { useChatRuntimeStore } from "@/store/chat-runtime-store"
import { useShallow } from "zustand/react/shallow"
import { AssistantActivityTimeline } from "@/components/chat/messages/ai-response-bubble/assistant-activity-timeline"
import type { ActivityTimelineBlock } from "@/lib/chat/message-protocol"
import {
  activityEventFromStatus,
  createActivityTimelineBlock,
  mergeActivityTimelineBlock,
} from "@/lib/chat/runtime-activity"
import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/shadcn/dropdown-menu"

function useActiveTimeline(): { block: ActivityTimelineBlock | null; isActive: boolean } {
  const { messages } = useChatStore(useShallow((s) => ({ messages: s.messages })))
  const { activeMessageId, statusStage, statusCode, statusMeta } = useChatRuntimeStore(
    useShallow((s) => ({
      activeMessageId: s.activeMessageId,
      statusStage: s.statusStage,
      statusCode: s.statusCode,
      statusMeta: s.statusMeta,
    }))
  )

  return useMemo(() => {
    if (!activeMessageId) return { block: null, isActive: false }
    const msg = messages.find((m) => m.id === activeMessageId)
    const persistedBlock = msg?.blocks?.find((b) => b.type === "activity_timeline") as
      | ActivityTimelineBlock
      | undefined

    const statusEvent = activityEventFromStatus({
      messageId: activeMessageId,
      stage: statusStage,
      code: statusCode,
      meta: statusMeta,
    })
    const liveBlock = statusEvent
      ? createActivityTimelineBlock(activeMessageId, [statusEvent])
      : null

    const block = persistedBlock && liveBlock
      ? mergeActivityTimelineBlock(persistedBlock, liveBlock)
      : liveBlock ?? persistedBlock ?? null

    return { block, isActive: true }
  }, [messages, activeMessageId, statusStage, statusCode, statusMeta])
}

export const HudActivityBar = memo(function HudActivityBar() {
  const { block, isActive } = useActiveTimeline()
  const [open, setOpen] = useState(false)

  const visible = Boolean(block)
  const eventCount = block?.events.length ?? 0

  if (!visible || !block) return null

  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-9 items-center gap-1.5 rounded-full px-2.5 text-left transition-colors",
            "text-slate-500 hover:bg-slate-900/5 hover:text-slate-700 dark:text-white/45 dark:hover:bg-white/8 dark:hover:text-white/70",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/40 dark:focus-visible:ring-white/20",
          )}
          aria-label={eventCount > 0 ? `调用链，${eventCount} 步` : "调用链"}
        >
          {isActive ? (
            <span className="relative flex h-[7px] w-[7px] shrink-0">
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
          ) : null}
          <span className="text-[10px] font-bold uppercase tracking-[0.14em]">调用链</span>
          {eventCount > 0 ? (
            <span className="text-[10px] font-semibold tabular-nums opacity-55">{eventCount}</span>
          ) : null}
          <ChevronDown
            size={13}
            className={cn(
              "shrink-0 text-slate-400 transition-transform duration-200 dark:text-white/30",
              open && "rotate-180",
            )}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="center"
        side="bottom"
        sideOffset={10}
        onCloseAutoFocus={(event) => event.preventDefault()}
        className={cn(
          "w-[min(calc(100vw-48px),340px)] rounded-2xl border-white/60 bg-white/82 p-0 text-foreground backdrop-blur-2xl dark:border-white/8 dark:bg-black/72",
          "shadow-[0_16px_38px_-18px_rgba(15,23,42,0.38)] dark:shadow-[0_16px_38px_-18px_rgba(0,0,0,0.65)]",
        )}
      >
        <div className="px-3 pb-3 pt-2">
          <AssistantActivityTimeline block={block} isActive={isActive} />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
})
