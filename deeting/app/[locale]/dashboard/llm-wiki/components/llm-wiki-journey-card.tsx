"use client"

import { Bot, CheckCircle2, DatabaseZap, FolderSearch, LoaderCircle } from "lucide-react"

import { Button } from "@/components/ui/button"
import { GlassCard, GlassCardDescription, GlassCardHeader, GlassCardTitle } from "@/components/ui/glass-card"
import type { LocalLlmWikiState } from "@/lib/api/llm-wiki"

type Translation = (key: string, values?: Record<string, string | number>) => string
type JourneyStageStatus = "pending" | "active" | "working" | "complete"
type JourneyTabValue = "setup" | "corpus" | "agent"

export function LlmWikiJourneyCard({
  t,
  state,
  hasSearchedCorpus,
  corpusHitCount,
  isAnalyzing,
  isBootstrapping,
  isSyncingCorpus,
  isSearchingCorpus,
  isSyncingAgent,
  onNavigateTab,
}: {
  t: Translation
  state: LocalLlmWikiState | null
  hasSearchedCorpus: boolean
  corpusHitCount: number
  isAnalyzing: boolean
  isBootstrapping: boolean
  isSyncingCorpus: boolean
  isSearchingCorpus: boolean
  isSyncingAgent: boolean
  onNavigateTab: (tab: JourneyTabValue) => void
}) {
  const binding = state?.binding
  const scan = state?.scanSummary
  const workspace = state?.workspaceStatus
  const corpus = state?.corpusStatus
  const maintainer = state?.maintainerAgent

  const stage1Ready = Boolean(binding && scan)
  const stage2Ready = Boolean(workspace?.workspaceExists && corpus?.lastSyncedAt)
  const stage3Ready = Boolean(maintainer && hasSearchedCorpus)

  const stage1Status: JourneyStageStatus = isAnalyzing
    ? "working"
    : stage1Ready
      ? "complete"
      : "active"
  const stage2Status: JourneyStageStatus =
    isBootstrapping || isSyncingCorpus
      ? "working"
      : stage2Ready
        ? "complete"
        : stage1Ready
          ? "active"
          : "pending"
  const stage3Status: JourneyStageStatus =
    isSearchingCorpus || isSyncingAgent
      ? "working"
      : stage3Ready
        ? "complete"
        : stage2Ready
          ? "active"
          : "pending"

  const stages = [
    {
      step: 1,
      icon: FolderSearch,
      status: stage1Status,
      title: t("journey.stages.connect.title"),
      description: t("journey.stages.connect.description"),
      targetTab: "setup" as const,
      evidence: stage1Ready
        ? t("journey.stages.connect.ready", {
            vaultName: binding?.vaultName ?? "Vault",
            count: scan?.totalMarkdownFiles ?? 0,
          })
        : t("journey.stages.connect.pending"),
    },
    {
      step: 2,
      icon: DatabaseZap,
      status: stage2Status,
      title: t("journey.stages.bootstrap.title"),
      description: t("journey.stages.bootstrap.description"),
      targetTab: workspace?.workspaceExists ? "corpus" : "setup",
      evidence: stage2Ready
        ? t("journey.stages.bootstrap.ready", {
            path: workspace?.resolvedWorkspacePath ?? "",
            count: corpus?.indexedNoteCount ?? 0,
          })
        : t("journey.stages.bootstrap.pending"),
    },
    {
      step: 3,
      icon: Bot,
      status: stage3Status,
      title: t("journey.stages.handoff.title"),
      description: t("journey.stages.handoff.description"),
      targetTab: hasSearchedCorpus ? "agent" : "corpus",
      evidence: stage3Ready
        ? t("journey.stages.handoff.ready", {
            count: corpusHitCount,
            name: maintainer?.name ?? "Maintainer",
          })
        : maintainer
          ? t("journey.stages.handoff.pendingWithMaintainer", {
              name: maintainer.name,
            })
          : t("journey.stages.handoff.pending"),
    },
  ] as const

  return (
    <GlassCard
      blur="lg"
      theme="surface"
      hover="none"
      className="overflow-hidden border-white/15 bg-[linear-gradient(135deg,rgba(255,255,255,0.82),rgba(246,249,255,0.74)_54%,rgba(239,252,248,0.7)_100%)] shadow-[0_24px_70px_-38px_rgba(15,23,42,0.32)]"
    >
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-16 top-0 h-28 w-28 rounded-full bg-sky-300/16 blur-3xl" />
        <div className="absolute right-20 top-12 h-32 w-32 rounded-full bg-indigo-300/14 blur-3xl" />
      </div>

      <GlassCardHeader className="relative border-b border-white/60 pb-5">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/60 bg-white/72 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
            <CheckCircle2 className="size-3.5 text-emerald-500" />
            {t("journey.eyebrow")}
          </div>
          <GlassCardTitle className="text-slate-900">
            {t("journey.title")}
          </GlassCardTitle>
          <GlassCardDescription className="max-w-3xl text-slate-500">
            {t("journey.description")}
          </GlassCardDescription>
        </div>
      </GlassCardHeader>

      <div className="relative grid gap-4 p-5 md:p-6 xl:grid-cols-3">
        {stages.map((stage) => (
          <JourneyStageCard
            key={stage.step}
            t={t}
            step={stage.step}
            icon={stage.icon}
            status={stage.status}
            title={stage.title}
            description={stage.description}
            targetTab={stage.targetTab}
            evidence={stage.evidence}
            onNavigateTab={onNavigateTab}
          />
        ))}
      </div>

      <div className="relative border-t border-white/60 px-5 py-4 text-sm text-slate-600 md:px-6">
        {t("journey.boundary")}
      </div>
    </GlassCard>
  )
}

function JourneyStageCard({
  t,
  step,
  icon: Icon,
  status,
  title,
  description,
  targetTab,
  evidence,
  onNavigateTab,
}: {
  t: Translation
  step: number
  icon: typeof FolderSearch
  status: JourneyStageStatus
  title: string
  description: string
  targetTab: JourneyTabValue
  evidence: string
  onNavigateTab: (tab: JourneyTabValue) => void
}) {
  const palette = journeyPalette(status)

  return (
    <div
      className={[
        "rounded-[1.75rem] border p-4 shadow-[0_18px_45px_-34px_rgba(15,23,42,0.28)] backdrop-blur-xl",
        palette.card,
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1.5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
            {t("journey.stepLabel", { step })}
          </div>
          <div className="flex items-center gap-2">
            <div className={["rounded-2xl p-2", palette.iconWrap].join(" ")}>
              <Icon className={["size-4", palette.icon].join(" ")} />
            </div>
            <div className="text-base font-semibold text-slate-900">{title}</div>
          </div>
        </div>
        <JourneyStatusPill
          t={t}
          status={status}
          onClick={status === "working" ? undefined : () => onNavigateTab(targetTab)}
        />
      </div>

      <div className="mt-4 text-sm leading-6 text-slate-600">{description}</div>
      <div className={["mt-4 rounded-2xl border px-3.5 py-3 text-sm leading-6", palette.evidence].join(" ")}>
        {evidence}
      </div>
    </div>
  )
}

function JourneyStatusPill({
  t,
  status,
  onClick,
}: {
  t: Translation
  status: JourneyStageStatus
  onClick?: () => void
}) {
  const palette = journeyPalette(status)
  const Icon = status === "working" ? LoaderCircle : CheckCircle2
  const isInteractive = Boolean(onClick) && status !== "working"

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      disabled={!isInteractive}
      className={[
        "h-auto rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] shadow-none",
        palette.pill,
        isInteractive
          ? "cursor-pointer hover:-translate-y-0.5 hover:brightness-[1.02]"
          : "cursor-default opacity-100 hover:bg-transparent",
      ].join(" ")}
    >
      <Icon className={["size-3.5", status === "working" ? "animate-spin" : ""].join(" ")} />
      {t(`journey.status.${status}`)}
    </Button>
  )
}

function journeyPalette(status: JourneyStageStatus) {
  switch (status) {
    case "complete":
      return {
        card: "border-emerald-200/80 bg-white/82",
        iconWrap: "bg-emerald-100",
        icon: "text-emerald-600",
        pill: "border-emerald-200 bg-emerald-50 text-emerald-700",
        evidence: "border-emerald-200/80 bg-emerald-50/80 text-emerald-950",
      }
    case "working":
      return {
        card: "border-sky-200/80 bg-white/82",
        iconWrap: "bg-sky-100",
        icon: "text-sky-600",
        pill: "border-sky-200 bg-sky-50 text-sky-700",
        evidence: "border-sky-200/80 bg-sky-50/80 text-sky-950",
      }
    case "active":
      return {
        card: "border-indigo-200/80 bg-white/82",
        iconWrap: "bg-indigo-100",
        icon: "text-indigo-600",
        pill: "border-indigo-200 bg-indigo-50 text-indigo-700",
        evidence: "border-indigo-200/80 bg-indigo-50/75 text-indigo-950",
      }
    default:
      return {
        card: "border-slate-200/80 bg-white/78",
        iconWrap: "bg-slate-100",
        icon: "text-slate-500",
        pill: "border-slate-200 bg-slate-50 text-slate-600",
        evidence: "border-slate-200/80 bg-slate-50/75 text-slate-700",
      }
  }
}
