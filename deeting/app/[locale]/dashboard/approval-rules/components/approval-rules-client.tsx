"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import {
  AlertTriangle,
  BrainCircuit,
  Filter,
  Loader2,
  ShieldCheck,
  ShieldOff,
  Sparkles,
  Trash2,
} from "lucide-react"

import {
  clearToolApprovalRules,
  deleteToolApprovalRule,
  getToolApprovalLearningSummary,
  listToolApprovalRules,
  resetToolApprovalLearning,
  type ToolApprovalLearningSummaryRow,
  type ToolApprovalRule,
} from "@/lib/api/approval-rules"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/shadcn/alert-dialog"
import { Button } from "@/components/ui/shadcn/button"
import { Input } from "@/components/ui/shadcn/input"
import { Container } from "@/components/ui/common/container"

type RuleFilter = "all" | "allow" | "deny"
type ConfirmAction = null | "clear-all" | "clear-allow" | "reset-learning"
type ApprovalClassLabels = Record<string, string>

function formatDate(value?: number | null) {
  if (!value) return "-"
  return new Date(value).toLocaleString()
}

function classifyRuleSource(rule: ToolApprovalRule) {
  if (rule.action === "deny_always") return "explicitDeny"
  if (rule.action === "allow_always" && rule.auto_promoted) return "autoPromoted"
  if (rule.action === "allow_always") return "explicitAllow"
  return "observed"
}

function toApprovalClassLabels(value: unknown): ApprovalClassLabels {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string"
    )
  )
}

function humanizeApprovalClassValue(value: string, fallback: string) {
  const normalized = value.trim()
  if (!normalized) return fallback
  if (!/^[A-Za-z0-9_-]+$/.test(normalized)) return normalized

  const words = normalized
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[_-\s]+/)
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLowerCase()
      return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`
    })

  return words.length > 0 ? words.join(" ") : fallback
}

function resolveApprovalClassLabel(
  labels: ApprovalClassLabels,
  value: string,
  fallback: string
) {
  const normalized = value.trim()
  if (!normalized) return fallback
  return labels[normalized] ?? humanizeApprovalClassValue(normalized, fallback)
}

function getLearningStatus(row: ToolApprovalLearningSummaryRow) {
  if (row.auto_promoted_rules > 0) return "autoPromoted"
  if (row.explicit_allow_rules > 0 || row.explicit_deny_rules > 0) return "stable"
  if (row.observed_approvals > 0) return "learning"
  return "normal"
}

function RuleChip({
  tone,
  children,
}: {
  tone: "allow" | "deny" | "info" | "learning"
  children: React.ReactNode
}) {
  const toneClass =
    tone === "allow"
      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : tone === "deny"
      ? "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300"
      : tone === "learning"
      ? "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300"
      : "border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300"

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${toneClass}`}
    >
      {children}
    </span>
  )
}

export function ApprovalRulesClient() {
  const t = useTranslations("approval-rules")
  const operationLabels = React.useMemo(
    () => toApprovalClassLabels(t.raw("classes.operation")),
    [t]
  )
  const targetLabels = React.useMemo(
    () => toApprovalClassLabels(t.raw("classes.target")),
    [t]
  )
  const boundaryLabels = React.useMemo(
    () => toApprovalClassLabels(t.raw("classes.boundary")),
    [t]
  )
  const [rules, setRules] = React.useState<ToolApprovalRule[]>([])
  const [summaryRows, setSummaryRows] = React.useState<ToolApprovalLearningSummaryRow[]>([])
  const [filter, setFilter] = React.useState<RuleFilter>("all")
  const [query, setQuery] = React.useState("")
  const [loading, setLoading] = React.useState(true)
  const [busyKey, setBusyKey] = React.useState<string | null>(null)
  const [confirmAction, setConfirmAction] = React.useState<ConfirmAction>(null)

  const reload = React.useCallback(async () => {
    setLoading(true)
    try {
      const [nextRules, nextSummary] = await Promise.all([
        listToolApprovalRules(),
        getToolApprovalLearningSummary(),
      ])
      setRules(nextRules)
      setSummaryRows(nextSummary)
    } catch (error) {
      console.error("[approval-rules] load failed", error)
      toast.error(t("toast.loadFailed"))
    } finally {
      setLoading(false)
    }
  }, [t])

  React.useEffect(() => {
    void reload()
  }, [reload])

  const filteredRules = React.useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return rules.filter((rule) => {
      if (filter === "allow" && rule.action === "deny_always") return false
      if (filter === "deny" && rule.action !== "deny_always") return false
      if (!normalizedQuery) return true

      const haystack = [
        rule.display_label,
        rule.tool_name,
        rule.operation_class,
        rule.target_class,
        rule.boundary_class,
        rule.risk_level ?? "",
      ]
        .join(" ")
        .toLowerCase()

      return haystack.includes(normalizedQuery)
    })
  }, [filter, query, rules])

  const explicitRules = filteredRules.filter((rule) => rule.action !== "allow_once")

  const handleRemoveRule = async (key: string) => {
    setBusyKey(key)
    try {
      await deleteToolApprovalRule(key)
      toast.success(t("toast.ruleRemoved"))
      await reload()
    } catch (error) {
      console.error("[approval-rules] remove failed", error)
      toast.error(t("toast.actionFailed"))
    } finally {
      setBusyKey(null)
    }
  }

  const handleDangerAction = async () => {
    if (!confirmAction) return
    setBusyKey(confirmAction)
    try {
      if (confirmAction === "clear-all") {
        await clearToolApprovalRules("all")
        toast.success(t("toast.clearAll"))
      } else if (confirmAction === "clear-allow") {
        await clearToolApprovalRules("allow")
        toast.success(t("toast.clearAllows"))
      } else {
        await resetToolApprovalLearning()
        toast.success(t("toast.resetLearning"))
      }
      setConfirmAction(null)
      await reload()
    } catch (error) {
      console.error("[approval-rules] danger action failed", error)
      toast.error(t("toast.actionFailed"))
    } finally {
      setBusyKey(null)
    }
  }

  const summaryStats = {
    active: explicitRules.length,
    allow: explicitRules.filter((rule) => rule.action !== "deny_always").length,
    deny: explicitRules.filter((rule) => rule.action === "deny_always").length,
    learning: summaryRows.length,
  }
  const operationFallback = operationLabels.unknown ?? t("classes.operation.unknown")
  const targetFallback = targetLabels.unknown ?? t("classes.target.unknown")
  const boundaryFallback = boundaryLabels.none ?? boundaryLabels.unknown ?? t("classes.boundary.none")
  const getOperationLabel = (value: string) =>
    resolveApprovalClassLabel(operationLabels, value, operationFallback)
  const getTargetLabel = (value: string) =>
    resolveApprovalClassLabel(targetLabels, value, targetFallback)
  const getBoundaryLabel = (value: string) =>
    resolveApprovalClassLabel(boundaryLabels, value, boundaryFallback)

  const content = (
    <>
      <div className="relative overflow-hidden rounded-[32px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.12),transparent_34%),radial-gradient(circle_at_80%_20%,rgba(14,165,233,0.12),transparent_30%),linear-gradient(180deg,rgba(255,255,255,0.92),rgba(249,250,251,0.88))] p-6 shadow-[0_30px_80px_-32px_rgba(15,23,42,0.35)] dark:bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.14),transparent_34%),radial-gradient(circle_at_80%_20%,rgba(14,165,233,0.14),transparent_30%),linear-gradient(180deg,rgba(10,10,15,0.96),rgba(8,8,12,0.96))]">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,transparent_0%,rgba(255,255,255,0.08)_48%,transparent_100%)] dark:bg-[linear-gradient(135deg,transparent_0%,rgba(255,255,255,0.04)_48%,transparent_100%)]" />

        <div className="relative flex flex-col gap-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl space-y-4">
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,rgba(245,158,11,0.16),rgba(14,165,233,0.18))] text-amber-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] dark:text-amber-300">
                    <ShieldCheck className="h-6 w-6" />
                  </div>
                  <RuleChip tone="info">{t("desktopOnly")}</RuleChip>
                </div>
                <div>
                  <h1 className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-white md:text-4xl">
                    {t("title")}
                  </h1>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
                    {t("subtitle")}
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {([
                ["active", summaryStats.active],
                ["allow", summaryStats.allow],
                ["deny", summaryStats.deny],
                ["learning", summaryStats.learning],
              ] as const).map(([key, value]) => (
                <div
                  key={key}
                  className="rounded-2xl border border-white/20 bg-white/75 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] backdrop-blur dark:border-white/10 dark:bg-white/5 dark:shadow-none"
                >
                  <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                    {t(`summary.${key}`)}
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">
                    {value}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <section className="rounded-[28px] border border-white/10 bg-white/80 p-5 shadow-[0_20px_60px_-30px_rgba(15,23,42,0.28)] backdrop-blur dark:bg-white/5">
            <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-white">
                  <Filter className="h-4 w-4 text-amber-500" />
                  {t("sections.rules")}
                </div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {t("subtitle")}
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <div className="inline-flex rounded-2xl border border-white/20 bg-slate-100/80 p-1 dark:bg-white/5">
                  {(["all", "allow", "deny"] as const).map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setFilter(item)}
                      className={`rounded-2xl px-3 py-2 text-xs font-medium transition ${
                        filter === item
                          ? "bg-white text-slate-900 shadow-sm dark:bg-white/10 dark:text-white"
                          : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                      }`}
                    >
                      {t(`filters.${item}`)}
                    </button>
                  ))}
                </div>
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("filters.searchPlaceholder")}
                  className="w-full min-w-[240px] rounded-2xl border-white/20 bg-white/70 dark:bg-white/5"
                />
              </div>
            </div>

            {loading ? (
              <div className="flex items-center gap-3 rounded-2xl border border-dashed border-white/15 p-6 text-sm text-slate-500 dark:text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("status.loading")}
              </div>
            ) : explicitRules.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-sm text-slate-500 dark:text-slate-400">
                {t("empty.rules")}
              </div>
            ) : (
              <div className="grid gap-4 xl:grid-cols-2">
                {explicitRules.map((rule) => {
                  const sourceKey = classifyRuleSource(rule)
                  const isDeny = rule.action === "deny_always"
                  return (
                    <div
                      key={rule.key}
                      className="group rounded-[26px] border border-white/15 bg-[linear-gradient(180deg,rgba(255,255,255,0.85),rgba(248,250,252,0.82))] p-5 shadow-[0_24px_60px_-36px_rgba(15,23,42,0.35)] transition hover:-translate-y-0.5 hover:shadow-[0_28px_70px_-36px_rgba(15,23,42,0.4)] dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.03))]"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-3">
                          <div className="flex items-center gap-2">
                            <RuleChip tone={isDeny ? "deny" : "allow"}>
                              {t(`source.${sourceKey}`)}
                            </RuleChip>
                            <RuleChip tone={rule.auto_promoted ? "learning" : "info"}>
                              {rule.risk_level ?? t("status.unknownRisk")}
                            </RuleChip>
                          </div>
                          <div>
                            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                              {rule.display_label}
                            </h2>
                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                              {rule.tool_name}
                            </p>
                          </div>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busyKey === rule.key}
                          onClick={() => void handleRemoveRule(rule.key)}
                        >
                          {busyKey === rule.key ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="mr-2 h-4 w-4" />
                          )}
                          {t("actions.removeRule")}
                        </Button>
                      </div>

                      <div className="mt-5 grid gap-3 md:grid-cols-2">
                        <div className="rounded-2xl border border-white/10 bg-white/60 p-3 dark:bg-white/5">
                          <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">
                            {getOperationLabel(rule.operation_class)}
                          </div>
                          <div className="mt-2 text-sm text-slate-700 dark:text-slate-300">
                            {getTargetLabel(rule.target_class)} ·{" "}
                            {getBoundaryLabel(rule.boundary_class)}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-white/60 p-3 dark:bg-white/5">
                          <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">
                            {t("meta.expires")}
                          </div>
                          <div className="mt-2 text-sm text-slate-700 dark:text-slate-300">
                            {rule.expires_at_unix_ms
                              ? formatDate(rule.expires_at_unix_ms)
                              : t("meta.never")}
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-2 text-xs text-slate-500 dark:text-slate-400 md:grid-cols-2">
                        <div>
                          {t("meta.created")}: {formatDate(rule.created_at_unix_ms)}
                        </div>
                        <div>
                          {t("meta.updated")}: {formatDate(rule.updated_at_unix_ms)}
                        </div>
                        <div>
                          {t("meta.approvals")}: {rule.approve_count}
                        </div>
                        <div>
                          {t("meta.rejections")}: {rule.reject_count}
                        </div>
                        <div>
                          {t("meta.halfLife", { days: rule.half_life_days })}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          <section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-[28px] border border-white/10 bg-white/80 p-5 shadow-[0_20px_60px_-30px_rgba(15,23,42,0.28)] backdrop-blur dark:bg-white/5">
              <div className="mb-5 flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-white">
                <BrainCircuit className="h-4 w-4 text-sky-500" />
                {t("sections.learning")}
              </div>
              <p className="mb-5 text-sm text-slate-500 dark:text-slate-400">
                {t("learning.description")}
              </p>

              {summaryRows.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-sm text-slate-500 dark:text-slate-400">
                  {t("empty.learning")}
                </div>
              ) : (
                <div className="space-y-3">
                  {summaryRows.map((row) => {
                    const status = getLearningStatus(row)
                    return (
                      <div
                        key={`${row.operation_class}-${row.target_class}-${row.boundary_class}`}
                        className="rounded-2xl border border-white/10 bg-white/60 p-4 dark:bg-white/5"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="text-sm font-semibold text-slate-900 dark:text-white">
                              {getOperationLabel(row.operation_class)} ·{" "}
                              {getTargetLabel(row.target_class)}
                            </div>
                            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                              {getBoundaryLabel(row.boundary_class)}
                            </div>
                          </div>
                          <RuleChip
                            tone={
                              status === "autoPromoted"
                                ? "learning"
                                : status === "stable"
                                ? "info"
                                : status === "learning"
                                ? "allow"
                                : "deny"
                            }
                          >
                            {t(`learning.status.${status}`)}
                          </RuleChip>
                        </div>
                        <div className="mt-4 grid gap-2 text-xs text-slate-500 dark:text-slate-400 sm:grid-cols-2">
                          <div>
                            {t("meta.approvals")}: {row.observed_approvals}
                          </div>
                          <div>
                            {t("meta.rejections")}: {row.observed_rejections}
                          </div>
                          <div>
                            {t("source.autoPromoted")}: {row.auto_promoted_rules}
                          </div>
                          <div>
                            {t("source.explicitAllow")}: {row.explicit_allow_rules}
                          </div>
                          <div>
                            {t("source.explicitDeny")}: {row.explicit_deny_rules}
                          </div>
                          <div>
                            {t("meta.updated")}:{" "}
                            {formatDate(
                              row.last_approved_at_unix_ms ?? row.last_rejected_at_unix_ms
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="rounded-[28px] border border-red-500/15 bg-[linear-gradient(180deg,rgba(255,248,240,0.9),rgba(255,245,245,0.92))] p-5 shadow-[0_20px_60px_-34px_rgba(185,28,28,0.3)] dark:bg-[linear-gradient(180deg,rgba(127,29,29,0.16),rgba(28,25,23,0.12))]">
              <div className="mb-4 flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-white">
                <AlertTriangle className="h-4 w-4 text-red-500" />
                {t("sections.danger")}
              </div>
              <p className="mb-5 text-sm text-slate-600 dark:text-slate-300">
                {t("danger.description")}
              </p>

              <div className="space-y-4">
                <div className="rounded-2xl border border-white/10 bg-white/70 p-4 dark:bg-white/5">
                  <div className="flex items-start gap-3">
                    <Sparkles className="mt-0.5 h-4 w-4 text-amber-500" />
                    <div className="space-y-3">
                      <div>
                        <div className="text-sm font-medium text-slate-900 dark:text-white">
                          {t("actions.resetLearning")}
                        </div>
                        <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                          {t("danger.resetLearningHelp")}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setConfirmAction("reset-learning")}
                      >
                        {t("actions.resetLearning")}
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/70 p-4 dark:bg-white/5">
                  <div className="flex items-start gap-3">
                    <ShieldCheck className="mt-0.5 h-4 w-4 text-emerald-500" />
                    <div className="space-y-3">
                      <div>
                        <div className="text-sm font-medium text-slate-900 dark:text-white">
                          {t("actions.clearAllows")}
                        </div>
                        <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                          {t("danger.clearAllowsHelp")}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setConfirmAction("clear-allow")}
                      >
                        {t("actions.clearAllows")}
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-red-500/15 bg-red-500/[0.08] p-4">
                  <div className="flex items-start gap-3">
                    <ShieldOff className="mt-0.5 h-4 w-4 text-red-500" />
                    <div className="space-y-3">
                      <div>
                        <div className="text-sm font-medium text-slate-900 dark:text-white">
                          {t("actions.clearAll")}
                        </div>
                        <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">
                          {t("danger.clearAllHelp")}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => setConfirmAction("clear-all")}
                      >
                        {t("actions.clearAll")}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      <AlertDialog open={confirmAction !== null} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction === "clear-all"
                ? t("confirm.clearAllTitle")
                : confirmAction === "clear-allow"
                ? t("confirm.clearAllowsTitle")
                : t("confirm.resetLearningTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction === "clear-all"
                ? t("confirm.clearAllBody")
                : confirmAction === "clear-allow"
                ? t("confirm.clearAllowsBody")
                : t("confirm.resetLearningBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("confirm.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleDangerAction()}>
              {busyKey === confirmAction ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {t("confirm.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )

  return (
    <Container as="main" gutter="md" size="full" className="py-6 md:py-8 !mx-0 !max-w-none">
      {content}
    </Container>
  )
}

