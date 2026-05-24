"use client"

import { memo } from "react"
import { Zap } from "lucide-react"

import { Badge } from "@/ui/shadcn/badge"
import { cn } from "@/lib/utils"
import {
  buildTransitionTimeline,
  hasTransitionDecisions,
  type TransitionTimelineEntry,
} from "@/lib/runtime/transition/selectors"
import { useI18n } from "@/hooks/use-i18n"
import { humanizeToolName } from "@/lib/chat/tool-ux"

type ToolOutcomeKind =
  | "resume_failed"
  | "resumed"
  | "waiting_approval"
  | "rejected"
  | "tool_failed"

interface ToolOutcomeInsight {
  kind: ToolOutcomeKind
  continuationCount?: number | null
  pendingApprovalCount?: number | null
}

interface TransitionTimelineProps {
  debug?: Record<string, unknown>
  outcome: ToolOutcomeInsight | null
}

export const TransitionTimeline = memo<TransitionTimelineProps>(
  function TransitionTimeline({ debug, outcome }) {
    const t = useI18n("chat")
    const entries = buildTransitionTimeline(debug)
    if (entries.length === 0 && !outcome) return null

    const showsTransitions = hasTransitionDecisions(entries)
    const titleKey = showsTransitions
      ? "toolResult.timeline.transitionTitle"
      : "toolResult.timeline.title"

    return (
      <div className="mb-3 rounded-lg border border-slate-200/80 bg-slate-50/80 px-3 py-2 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-950/20 dark:text-slate-200">
        <div className="mb-2 flex items-center gap-2 font-bold uppercase tracking-wider">
          <Zap size={13} />
          <span>{t(titleKey)}</span>
        </div>
        <ol className="space-y-1.5">
          {entries.map((entry) => (
            <TimelineRow key={entry.key} entry={entry} t={t} />
          ))}
          {outcome ? <OutcomeRow outcome={outcome} t={t} /> : null}
        </ol>
      </div>
    )
  },
)

type Translator = ReturnType<typeof useI18n>

function TimelineRow({
  entry,
  t,
}: {
  entry: TransitionTimelineEntry
  t: Translator
}) {
  if (entry.kind === "tool_exec") {
    return <ToolExecRow entry={entry} t={t} />
  }
  return <DecisionRow entry={entry} t={t} />
}

function DotMarker({ tone }: { tone: "ok" | "warn" | "danger" | "info" }) {
  return (
    <span
      className={cn(
        "mt-1 h-2 w-2 shrink-0 rounded-full",
        tone === "ok" && "bg-emerald-500",
        tone === "warn" && "bg-amber-500",
        tone === "danger" && "bg-red-500",
        tone === "info" && "bg-sky-500",
      )}
    />
  )
}

function DecisionRow({
  entry,
  t,
}: {
  entry: Extract<TransitionTimelineEntry, { kind: "decision" }>
  t: Translator
}) {
  const tone: "ok" | "warn" | "danger" | "info" = entry.correlation
    ? entry.correlation.outcome === "matched"
      ? "ok"
      : entry.correlation.outcome === "contradicted"
        ? "danger"
        : "warn"
    : entry.requiredArtifact
      ? "warn"
      : "info"

  const fromLabel = t(`toolResult.timeline.state.${entry.fromState}`)
  const toLabel = t(`toolResult.timeline.state.${entry.toState}`)
  const actionLabel = t(`toolResult.timeline.action.${entry.proposedAction}`)
  const subjectLabel =
    entry.toolName ?? entry.capabilityId ?? actionLabel

  return (
    <li className="flex gap-2">
      <DotMarker tone={tone} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <span className="truncate font-medium">
            <span className="opacity-70">{fromLabel}</span>
            <span className="mx-1 opacity-50">→</span>
            <span>{toLabel}</span>
            <span className="ml-2 font-mono text-[10px] opacity-65">
              {subjectLabel}
            </span>
          </span>
          <div className="flex shrink-0 items-center gap-1">
            {entry.requiredArtifact ? (
              <Badge
                variant="outline"
                className={cn(
                  "h-5 text-[10px] font-normal",
                  entry.enforced
                    ? "border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-300"
                    : "border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300",
                )}
              >
                {t(
                  `toolResult.timeline.artifact.${entry.requiredArtifact}`,
                )}
              </Badge>
            ) : null}
            {entry.correlation ? (
              <Badge
                variant="outline"
                className={cn(
                  "h-5 text-[10px] font-normal",
                  entry.correlation.outcome === "matched"
                    ? "border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-300"
                    : entry.correlation.outcome === "contradicted"
                      ? "border-red-300 text-red-700 dark:border-red-700 dark:text-red-300"
                      : "border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-300",
                )}
              >
                {t(
                  `toolResult.timeline.correlation.${entry.correlation.outcome}`,
                )}
              </Badge>
            ) : null}
          </div>
        </div>
        {entry.reason ? (
          <div className="mt-0.5 text-[10px] leading-4 opacity-70">
            {entry.reason}
          </div>
        ) : null}
      </div>
    </li>
  )
}

function ToolExecRow({
  entry,
  t,
}: {
  entry: Extract<TransitionTimelineEntry, { kind: "tool_exec" }>
  t: Translator
}) {
  const tone: "ok" | "warn" | "danger" =
    entry.status === "failed" || entry.status === "error"
      ? "danger"
      : entry.status === "success"
        ? "ok"
        : "warn"

  return (
    <li className="flex gap-2">
      <DotMarker tone={tone} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <span className="truncate font-medium">
            {t("toolResult.timeline.tool", {
              index: entry.callIndex + 1,
              toolName: humanizeToolName(entry.toolName) ?? entry.toolName,
            })}
          </span>
          <span className="shrink-0 rounded-full border border-current/15 px-1.5 py-0.5 text-[10px] opacity-75">
            {entry.durationMs !== null
              ? t("toolResult.timeline.duration", {
                  duration: entry.durationMs,
                })
              : entry.status}
          </span>
        </div>
        {entry.error ? (
          <div className="mt-0.5 font-mono text-[10px] text-red-700 dark:text-red-300">
            {entry.errorCode ? `[${entry.errorCode}] ` : ""}
            {entry.error}
          </div>
        ) : null}
      </div>
    </li>
  )
}

function OutcomeRow({
  outcome,
  t,
}: {
  outcome: ToolOutcomeInsight
  t: Translator
}) {
  return (
    <li key={`outcome-${outcome.kind}`} className="flex gap-2">
      <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-current opacity-55" />
      <div className="min-w-0 flex-1">
        <div className="font-medium">
          {t(`toolResult.timeline.outcome.${outcome.kind}`)}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] opacity-70">
          {outcome.continuationCount != null ? (
            <span>
              {t("toolResult.outcome.continuations", {
                count: outcome.continuationCount,
              })}
            </span>
          ) : null}
          {outcome.pendingApprovalCount != null ? (
            <span>
              {t("toolResult.outcome.pendingApprovals", {
                count: outcome.pendingApprovalCount,
              })}
            </span>
          ) : null}
        </div>
      </div>
    </li>
  )
}
