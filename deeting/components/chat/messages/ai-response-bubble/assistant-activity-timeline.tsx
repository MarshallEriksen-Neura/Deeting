"use client";

import { memo } from "react";
import { AlertCircle, Check, Circle, Clock, Loader2, MoreHorizontal, ShieldAlert } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import type { ActivityTimelineBlock, RuntimeActivityEvent } from "@/lib/chat/message-protocol";
import { buildActivityTimelineViewModel } from "@/lib/chat/runtime-activity";
import { cn } from "@/lib/utils";

function StatusIcon({ event }: { event: RuntimeActivityEvent }) {
  const iconClass = cn(event.status === "running" && "animate-spin");
  const props = { size: 9, strokeWidth: 2.2, className: iconClass };
  if (event.level === "action" || event.status === "waiting") return <ShieldAlert {...props} />;
  if (event.level === "error" || event.status === "failed") return <AlertCircle {...props} />;
  if (event.level === "warning" || event.status === "cancelled") return <AlertCircle {...props} />;
  if (event.status === "done") return <Check {...props} />;
  if (event.status === "running") return <Loader2 {...props} />;
  return <Circle {...props} />;
}

function dotClass(event: RuntimeActivityEvent) {
  if (event.level === "action" || event.status === "waiting") {
    return "border-amber-400 bg-amber-100 text-amber-700 dark:border-amber-300/70 dark:bg-amber-400/15 dark:text-amber-200";
  }
  if (event.level === "error" || event.status === "failed") {
    return "border-red-400 bg-red-50 text-red-700 dark:border-red-400/70 dark:bg-red-500/15 dark:text-red-200";
  }
  if (event.level === "warning" || event.status === "cancelled") {
    return "border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-300/70 dark:bg-orange-400/15 dark:text-orange-200";
  }
  if (event.status === "done" || event.level === "success") {
    return "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-300/70 dark:bg-emerald-400/15 dark:text-emerald-200";
  }
  return "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-300/60 dark:bg-sky-400/15 dark:text-sky-200";
}

function rowClass(event: RuntimeActivityEvent) {
  if (event.level === "action" || event.level === "error" || event.level === "warning") {
    return "text-foreground";
  }
  return "text-muted-foreground";
}

function statusText(event: RuntimeActivityEvent) {
  switch (event.status) {
    case "waiting":
      return "等待";
    case "running":
      return "进行中";
    case "done":
      return "完成";
    case "failed":
      return "失败";
    case "cancelled":
      return "取消";
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

  if (!viewModel.visible) return null;

  if (viewModel.collapsed) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 3 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-2 flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground/75"
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-emerald-300/70 bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200">
          <Check size={10} strokeWidth={2} />
        </span>
        <span className="min-w-0 truncate">{viewModel.summary}</span>
      </motion.div>
    );
  }

  return (
    <div className="mb-3 ml-0.5 max-w-full overflow-hidden">
      <div className="relative space-y-1.5 pl-4">
        <div className="absolute bottom-2 left-[7px] top-2 w-px bg-border/70" />
        {viewModel.hiddenCount > 0 ? (
          <div className="relative flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground/55">
            <span className="absolute -left-[13px] flex h-4 w-4 items-center justify-center rounded-full border border-border bg-background">
              <MoreHorizontal size={10} />
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
    </div>
  );
});

const ActivityTimelineItem = memo<{ event: RuntimeActivityEvent }>(
  function ActivityTimelineItem({ event }) {
    const state = statusText(event);

    return (
      <motion.div
        layout
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -2 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className={cn("relative min-w-0 pr-1", rowClass(event))}
      >
        <span
          className={cn(
            "absolute -left-[15px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full border",
            dotClass(event),
          )}
        >
          <StatusIcon event={event} />
        </span>
        <div className="flex min-w-0 items-baseline gap-2">
          <div className="min-w-0 truncate text-[12px] font-medium leading-5">
            {event.title}
          </div>
          {state ? (
            <div className="shrink-0 text-[10px] text-muted-foreground/55">
              {state}
            </div>
          ) : null}
        </div>
        {event.detail ? (
          <div className="min-w-0 truncate text-[11px] leading-4 text-muted-foreground/65">
            {event.detail}
          </div>
        ) : null}
      </motion.div>
    );
  },
);

export const ActivityTimelinePlaceholder = memo(function ActivityTimelinePlaceholder() {
  return (
    <div className="mb-2 flex items-center gap-2 text-[11px] text-muted-foreground/70">
      <Clock size={12} />
      <span>准备执行</span>
    </div>
  );
});


