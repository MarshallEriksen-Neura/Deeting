"use client";

import { memo, useEffect, useRef, useState } from "react";
import { AlertCircle, Check, MoreHorizontal, ShieldAlert } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import type { ActivityTimelineBlock, RuntimeActivityEvent } from "@/lib/chat/message-protocol";
import { buildActivityTimelineViewModel } from "@/lib/chat/runtime-activity";
import { cn } from "@/lib/utils";

const MIN_DISPLAY_MS = 900;

function useMinDisplayTime(visible: boolean): boolean {
  const [held, setHeld] = useState(false);
  const shownAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (visible && !shownAtRef.current) {
      shownAtRef.current = Date.now();
      setHeld(true);
    }
    if (!visible && shownAtRef.current) {
      const elapsed = Date.now() - shownAtRef.current;
      const remaining = MIN_DISPLAY_MS - elapsed;
      if (remaining > 0) {
        const timer = setTimeout(() => {
          setHeld(false);
          shownAtRef.current = null;
        }, remaining);
        return () => clearTimeout(timer);
      }
      setHeld(false);
      shownAtRef.current = null;
    }
  }, [visible]);

  return visible || held;
}

function StatusDot({ event }: { event: RuntimeActivityEvent }) {
  if (event.level === "action" || event.status === "waiting") {
    return (
      <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full border border-amber-300/80 bg-amber-50 dark:border-amber-400/40 dark:bg-amber-400/10">
        <ShieldAlert size={9} strokeWidth={2} className="text-amber-600 dark:text-amber-300" />
      </span>
    );
  }
  if (event.level === "error" || event.status === "failed") {
    return (
      <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full border border-red-300/80 bg-red-50 dark:border-red-400/40 dark:bg-red-400/10">
        <AlertCircle size={9} strokeWidth={2} className="text-red-600 dark:text-red-300" />
      </span>
    );
  }
  if (event.status === "done") {
    return (
      <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-emerald-500/10 dark:bg-emerald-400/10">
        <Check size={9} strokeWidth={2.5} className="text-emerald-600 dark:text-emerald-400" />
      </span>
    );
  }
  // running — breathing dot
  return (
    <span className="relative flex h-[18px] w-[18px] items-center justify-center">
      <motion.span
        className="absolute h-2 w-2 rounded-full bg-[#6d5cff]/20 dark:bg-[var(--accent)]/20"
        animate={{ scale: [1, 1.8, 1], opacity: [0.4, 0, 0.4] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.span
        className="relative h-[5px] w-[5px] rounded-full bg-[#6d5cff] dark:bg-[var(--accent)]"
        animate={{ opacity: [0.6, 1, 0.6] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
      />
    </span>
  );
}

function statusText(event: RuntimeActivityEvent) {
  switch (event.status) {
    case "waiting":
      return "等待";
    case "running":
      return null;
    case "done":
      return null;
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
    default:
      return null;
  }
}

export const AssistantActivityTimeline = memo<{
  block: ActivityTimelineBlock;
  isActive: boolean;
}>(function AssistantActivityTimeline({ block, isActive }) {
  const viewModel = buildActivityTimelineViewModel(block, {
    isActive,
    maxVisible: 5,
  });

  const shouldShow = useMinDisplayTime(viewModel.visible && !viewModel.collapsed);

  if (!viewModel.visible && !shouldShow) return null;

  if (viewModel.collapsed && !shouldShow) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 2 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
        className="mb-2 flex min-w-0 items-center gap-2.5 text-[11px] text-muted-foreground/70"
      >
        <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-emerald-500/10 dark:bg-emerald-400/10">
          <Check size={9} strokeWidth={2.5} className="text-emerald-600 dark:text-emerald-400" />
        </span>
        <span className="min-w-0 truncate font-medium">{viewModel.summary}</span>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -2, transition: { duration: 0.35, ease: [0.25, 0.1, 0.25, 1] } }}
      transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
      className="mb-3 max-w-full overflow-hidden"
    >
      <div className="relative space-y-0.5 pl-6">
        <div className="absolute bottom-1 left-[8px] top-1 w-px bg-border/40 dark:bg-border/30" />
        {viewModel.hiddenCount > 0 ? (
          <div className="relative flex min-w-0 items-center gap-2.5 py-1 text-[11px] text-muted-foreground/50">
            <span className="absolute -left-[14.5px] flex h-[18px] w-[18px] items-center justify-center rounded-full bg-muted/50 dark:bg-muted/30">
              <MoreHorizontal size={10} className="text-muted-foreground/50" />
            </span>
            <span>已收起 {viewModel.hiddenCount} 个较早步骤</span>
          </div>
        ) : null}
        <AnimatePresence initial={false}>
          {viewModel.events.map((event) => (
            <ActivityTimelineItem key={event.id} event={event} />
          ))}
        </AnimatePresence>
      </div>
    </motion.div>
  );
});

const ActivityTimelineItem = memo<{ event: RuntimeActivityEvent }>(
  function ActivityTimelineItem({ event }) {
    const state = statusText(event);
    const isRunning = event.status === "running";

    return (
      <motion.div
        layout
        initial={{ opacity: 0, y: 3 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -2, transition: { duration: 0.3, ease: [0.25, 0.1, 0.25, 1] } }}
        transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
        className="relative min-w-0 py-[3px]"
      >
        <span className="absolute -left-[14.5px] top-[5px]">
          <StatusDot event={event} />
        </span>
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "min-w-0 truncate text-[12px] leading-5",
              isRunning
                ? "font-medium text-foreground/90 dark:text-foreground/85"
                : event.status === "done"
                  ? "text-muted-foreground/70"
                  : "font-medium text-foreground/80",
            )}
          >
            {event.title}
          </span>
          {state ? (
            <span className="shrink-0 text-[10px] font-medium text-amber-600/80 dark:text-amber-300/70">
              {state}
            </span>
          ) : null}
        </div>
        {event.detail ? (
          <div className="min-w-0 truncate text-[11px] leading-4 text-muted-foreground/50">
            {event.detail}
          </div>
        ) : null}
      </motion.div>
    );
  },
);

export const ActivityTimelinePlaceholder = memo(function ActivityTimelinePlaceholder() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
      className="mb-2 flex items-center gap-2.5 text-[11px] text-muted-foreground/60"
    >
      <span className="relative flex h-[18px] w-[18px] items-center justify-center">
        <motion.span
          className="h-[5px] w-[5px] rounded-full bg-muted-foreground/30"
          animate={{ opacity: [0.3, 0.7, 0.3] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        />
      </span>
      <span className="font-medium">准备中</span>
    </motion.div>
  );
});


