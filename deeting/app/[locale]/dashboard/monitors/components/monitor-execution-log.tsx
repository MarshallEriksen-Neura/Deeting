"use client"

import { useCallback } from "react"
import { AnimatePresence, motion } from "framer-motion"
import {
  X,
  CheckCircle2,
  XCircle,
  MinusCircle,
  ThumbsUp,
  ThumbsDown,
  Coins,
  Clock,
  AlertTriangle,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { GlassCard } from "@/components/ui/glass-card"
import { useMonitorDeliveryStates, useMonitorLogs } from "@/lib/swr/use-monitors"
import { submitMonitorFeedback } from "@/lib/api/monitors"
import type {
  MonitorDeliveryStateRecord,
  MonitorExecutionLog as LogEntry,
} from "@/lib/api/monitors"

interface MonitorExecutionLogProps {
  taskId: string | null
  onClose: () => void
}

const LOG_STATUS_CONFIG = {
  success: {
    icon: CheckCircle2,
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    label: "成功",
  },
  failure: {
    icon: XCircle,
    color: "text-red-400",
    bg: "bg-red-500/10",
    label: "失败",
  },
  skipped: {
    icon: MinusCircle,
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    label: "跳过",
  },
} as const

export function MonitorExecutionLog({
  taskId,
  onClose,
}: MonitorExecutionLogProps) {
  const { data: logs, isLoading, mutate } = useMonitorLogs(taskId)
  const { data: deliveryStates } = useMonitorDeliveryStates(taskId)

  const handleFeedback = useCallback(
    async (log: LogEntry, score: number) => {
      try {
        await submitMonitorFeedback(log.task_id, log.id, score)
        mutate()
      } catch {
        // silent
      }
    },
    [mutate]
  )

  return (
    <AnimatePresence>
      {taskId && (
        <>
          {/* Overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Drawer */}
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 250 }}
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col border-l border-white/10 bg-[var(--card)]/95 backdrop-blur-2xl shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/5 px-6 py-4">
              <div>
                <h2 className="text-base font-semibold text-[var(--foreground)]">
                  执行日志
                </h2>
                <p className="mt-0.5 text-xs text-[var(--muted)]">
                  最近 {logs?.total ?? 0} 条研判记录
                </p>
              </div>
              <button
                onClick={onClose}
                className="rounded-lg p-1.5 text-[var(--muted)] transition-colors hover:bg-[var(--foreground)]/5 hover:text-[var(--foreground)]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {deliveryStates?.items?.length ? (
                <div className="mb-4 rounded-xl border border-white/8 bg-[var(--foreground)]/[0.03] p-3">
                  <div className="mb-2 text-[11px] font-medium text-[var(--muted)]">
                    交付锚点
                  </div>
                  <div className="space-y-2">
                    {deliveryStates.items.map((item) => (
                      <DeliveryStateRow key={`${item.channel_id}-${item.target_key}`} item={item} />
                    ))}
                  </div>
                </div>
              ) : null}
              {isLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div
                      key={i}
                      className="h-28 animate-pulse rounded-xl bg-[var(--foreground)]/5"
                    />
                  ))}
                </div>
              ) : !logs?.items?.length ? (
                <div className="flex flex-col items-center justify-center py-16 text-[var(--muted)]">
                  <Clock className="mb-3 h-10 w-10 opacity-30" />
                  <p className="text-sm">暂无执行记录</p>
                  <p className="mt-1 text-xs opacity-60">
                    任务被触发后将在此显示研判日志
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <AnimatePresence initial={false}>
                    {logs.items.map((log, index) => (
                      <motion.div
                        key={log.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.03 }}
                      >
                        <LogCard
                          log={log}
                          onFeedback={handleFeedback}
                        />
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

function DeliveryStateRow({ item }: { item: MonitorDeliveryStateRecord }) {
  return (
    <div className="rounded-lg border border-white/6 bg-black/10 px-3 py-2">
      <div className="flex items-center gap-2 text-[11px] text-[var(--foreground)]">
        <span className="rounded bg-[var(--foreground)]/8 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--muted)]">
          {item.channel_kind || item.target_key.split(":")[0] || "channel"}
        </span>
        <span className="truncate">
          {item.channel_display_name || item.target_key}
        </span>
        <span className="ml-auto rounded bg-[var(--foreground)]/6 px-1.5 py-0.5 text-[10px] text-[var(--muted)]">
          {deliveryStateLabel(item)}
        </span>
      </div>
      <div className="mt-1 text-[10px] text-[var(--muted)]">
        <span className="mr-2">{item.target_key}</span>
        {item.anchor_message_id
          ? `消息锚点: ${item.anchor_message_id}`
          : `上下文锚点: ${formatAnchorContext(item.anchor_context)}`}
      </div>
    </div>
  )
}

function LogCard({
  log,
  onFeedback,
}: {
  log: LogEntry
  onFeedback: (log: LogEntry, score: number) => void
}) {
  const config = LOG_STATUS_CONFIG[log.status] ?? LOG_STATUS_CONFIG.failure
  const StatusIcon = config.icon
  const hasChange = log.output_data?.is_significant_change === true
  const summary = log.output_data?.change_summary
  const events = log.output_data?.events ?? []

  return (
    <GlassCard padding="sm" hover="none" className="relative">
      {/* Status + Time header */}
      <div className="mb-2 flex items-center gap-2">
        <div
          className={cn(
            "flex items-center gap-1 rounded-lg px-2 py-0.5",
            config.bg
          )}
        >
          <StatusIcon className={cn("h-3 w-3", config.color)} />
          <span className={cn("text-[11px] font-medium", config.color)}>
            {config.label}
          </span>
        </div>

        {hasChange && (
          <span className="flex items-center gap-1 rounded-lg bg-[var(--primary)]/10 px-2 py-0.5 text-[11px] font-medium text-[var(--primary)]">
            <AlertTriangle className="h-3 w-3" />
            质变
          </span>
        )}

        <span className="ml-auto text-[10px] tabular-nums text-[var(--muted)]">
          {formatTime(log.triggered_at)}
        </span>
      </div>

      {/* Summary */}
      {summary ? (
        <p className="mb-2 text-xs leading-relaxed text-[var(--foreground)]/80">
          {summary.slice(0, 200)}
          {summary.length > 200 && "..."}
        </p>
      ) : log.error_message ? (
        <p className="mb-2 text-xs leading-relaxed text-red-400/80">
          {log.error_message.slice(0, 150)}
        </p>
      ) : null}

      {/* Orchestration timeline */}
      {events.length > 0 && (
        <div className="mb-2 mt-1 space-y-1 border-l border-white/10 pl-3">
          {events.slice(0, 6).map((evt, idx) => {
            const kind = typeof evt.kind === "string" ? evt.kind : ""
            const stage = typeof evt.stage === "string" ? evt.stage : ""
            const step = typeof evt.step === "string" ? evt.step : ""
            const state = typeof evt.state === "string" ? evt.state : ""
            const summary = typeof evt.summary === "string" ? evt.summary : ""
            const key = `${idx}-${kind}-${stage}-${step}`
            return (
              <div key={key} className="flex items-center gap-2 text-[10px] text-[var(--muted)]">
                <span className="inline-flex h-1.5 w-1.5 rounded-full bg-[var(--muted)]" />
                <span className="uppercase text-[9px] tracking-wide opacity-70">
                  {kind || stage || "event"}
                </span>
                <span className="text-[var(--foreground)]/80">
                  {summary || step || state || "event"}
                </span>
              </div>
            )
          })}
          {events.length > 6 && (
            <div className="pl-3 text-[9px] text-[var(--muted)]">… 等 {events.length - 6} 条事件</div>
          )}
        </div>
      )}

      {/* Footer: tokens + feedback */}
      <div className="flex items-center gap-3 pt-1 border-t border-white/5">
        <div className="flex items-center gap-1 text-[var(--muted)]">
          <Coins className="h-3 w-3" />
          <span className="text-[10px] tabular-nums">{log.tokens_used}</span>
        </div>

        {log.input_data?.strategy && (
          <span className="rounded bg-[var(--foreground)]/5 px-1.5 py-0.5 text-[10px] text-[var(--muted)]">
            {log.input_data.strategy}
          </span>
        )}

        {/* Feedback buttons */}
        {log.status === "success" && (
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => onFeedback(log, 1.0)}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] text-emerald-400 transition-colors hover:bg-emerald-500/10"
              title="有价值，强化此策略"
            >
              <ThumbsUp className="h-3 w-3" />
              有用
            </button>
            <button
              onClick={() => onFeedback(log, 0.0)}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] text-[var(--muted)] transition-colors hover:bg-red-500/10 hover:text-red-400"
              title="无意义，削弱此策略"
            >
              <ThumbsDown className="h-3 w-3" />
              无用
            </button>
          </div>
        )}
      </div>
    </GlassCard>
  )
}

function formatTime(isoStr: string): string {
  const d = new Date(isoStr)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return "刚刚"
  if (diffMin < 60) return `${diffMin}分钟前`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `${diffH}小时前`
  return d.toLocaleDateString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function formatAnchorContext(anchorContext: Record<string, unknown>): string {
  if (typeof anchorContext.context_token === "string" && anchorContext.context_token.trim()) {
    return anchorContext.context_token
  }
  if (typeof anchorContext.chat_id === "string" && anchorContext.chat_id.trim()) {
    return anchorContext.chat_id
  }
  if (typeof anchorContext.contact_id === "string" && anchorContext.contact_id.trim()) {
    return anchorContext.contact_id
  }
  return "已建立"
}

function deliveryStateLabel(item: MonitorDeliveryStateRecord): string {
  if (item.status === "anchored") {
    return "线程锚点已建立"
  }
  if (item.status === "context_ready") {
    return "上下文已建立"
  }
  if (item.status === "waiting_for_contact_message") {
    return "等待联系人先发消息"
  }
  return "待建立线程锚点"
}
