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
import { Container } from "@/components/ui/common/container"
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
import { Badge } from "@/components/ui/shadcn/badge"
import { Button } from "@/components/ui/shadcn/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/shadcn/card"
import { Input } from "@/components/ui/shadcn/input"

type RuleFilter = "all" | "allow" | "deny"
type ConfirmAction = null | "clear-all" | "clear-allow" | "reset-learning"
type ApprovalClassLabels = Record<string, string>

function formatDate(value?: number | null) {
  if (!value) return "-"
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
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
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
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
  fallback: string,
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

function SourceBadge({
  tone,
  children,
}: {
  tone: "allow" | "deny" | "info" | "learning"
  children: React.ReactNode
}) {
  const toneClass =
    tone === "allow"
      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700"
      : tone === "deny"
        ? "border-rose-500/20 bg-rose-500/10 text-rose-700"
        : tone === "learning"
          ? "border-amber-500/20 bg-amber-500/10 text-amber-700"
          : "border-sky-500/20 bg-sky-500/10 text-sky-700"

  return (
    <Badge
      variant="outline"
      className={`border px-2.5 py-1 text-[11px] font-medium ${toneClass}`}
    >
      {children}
    </Badge>
  )
}

function StatCard({
  label,
  value,
}: {
  label: string
  value: number
}) {
  return (
    <Card className="border-[color:var(--hairline)] bg-[color:var(--panel-bg)]/78 shadow-none">
      <CardContent className="p-4">
        <div className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--ink-3)]">
          {label}
        </div>
        <div className="mt-2 text-2xl font-semibold text-[color:var(--ink)]">{value}</div>
      </CardContent>
    </Card>
  )
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-[color:var(--hairline)] bg-[color:var(--panel-bg)]/50 p-8 text-center text-sm text-[color:var(--ink-3)]">
      {children}
    </div>
  )
}

export function ApprovalRulesClient() {
  const t = useTranslations("approval-rules")
  const operationLabels = React.useMemo(
    () => toApprovalClassLabels(t.raw("classes.operation")),
    [t],
  )
  const targetLabels = React.useMemo(
    () => toApprovalClassLabels(t.raw("classes.target")),
    [t],
  )
  const boundaryLabels = React.useMemo(
    () => toApprovalClassLabels(t.raw("classes.boundary")),
    [t],
  )
  const [rules, setRules] = React.useState<ToolApprovalRule[]>([])
  const [summaryRows, setSummaryRows] = React.useState<ToolApprovalLearningSummaryRow[]>(
    [],
  )
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
  const allExplicitRules = React.useMemo(
    () => rules.filter((rule) => rule.action !== "allow_once"),
    [rules],
  )

  const handleRemoveRule = React.useCallback(
    async (key: string) => {
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
    },
    [reload, t],
  )

  const handleDangerAction = React.useCallback(async () => {
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
  }, [confirmAction, reload, t])

  const summaryStats = React.useMemo(
    () => ({
      active: allExplicitRules.length,
      allow: allExplicitRules.filter((rule) => rule.action !== "deny_always").length,
      deny: allExplicitRules.filter((rule) => rule.action === "deny_always").length,
      learning: summaryRows.length,
    }),
    [allExplicitRules, summaryRows.length],
  )

  const operationFallback = operationLabels.unknown ?? "Unknown operation"
  const targetFallback = targetLabels.unknown ?? "Unknown target"
  const boundaryFallback =
    boundaryLabels.none ?? boundaryLabels.unknown ?? "Unknown boundary"
  const getOperationLabel = (value: string) =>
    resolveApprovalClassLabel(operationLabels, value, operationFallback)
  const getTargetLabel = (value: string) =>
    resolveApprovalClassLabel(targetLabels, value, targetFallback)
  const getBoundaryLabel = (value: string) =>
    resolveApprovalClassLabel(boundaryLabels, value, boundaryFallback)

  const confirmTitle =
    confirmAction === "clear-all"
      ? t("confirm.clearAllTitle")
      : confirmAction === "clear-allow"
        ? t("confirm.clearAllowsTitle")
        : t("confirm.resetLearningTitle")
  const confirmBody =
    confirmAction === "clear-all"
      ? t("confirm.clearAllBody")
      : confirmAction === "clear-allow"
        ? t("confirm.clearAllowsBody")
        : t("confirm.resetLearningBody")

  return (
    <Container as="main" gutter="md" size="full" className="py-6 md:py-8 !mx-0 !max-w-none">
      <div className="space-y-6">
        <Card className="overflow-hidden border-[color:var(--hairline)] bg-[linear-gradient(145deg,color-mix(in_srgb,var(--panel-bg)_94%,white_6%)_0%,color-mix(in_srgb,var(--panel-bg)_84%,var(--window-bg)_16%)_100%)] shadow-[var(--elev-floating)]">
          <CardHeader className="gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-3">
                <div className="flex size-11 items-center justify-center rounded-2xl bg-[color:var(--accent-soft)] text-[color:var(--accent-strong)]">
                  <ShieldCheck className="size-5" />
                </div>
                <SourceBadge tone="info">{t("desktopOnly")}</SourceBadge>
              </div>
              <div className="space-y-2">
                <CardTitle className="text-2xl tracking-[-0.04em] md:text-3xl">
                  {t("title")}
                </CardTitle>
                <CardDescription className="max-w-3xl text-sm leading-6 text-[color:var(--ink-3)]">
                  {t("subtitle")}
                </CardDescription>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard label={t("summary.active")} value={summaryStats.active} />
              <StatCard label={t("summary.allow")} value={summaryStats.allow} />
              <StatCard label={t("summary.deny")} value={summaryStats.deny} />
              <StatCard label={t("summary.learning")} value={summaryStats.learning} />
            </div>
          </CardHeader>
        </Card>

        <Card className="border-[color:var(--hairline)] bg-[color:var(--panel-bg)] shadow-none">
          <CardHeader className="gap-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div className="space-y-2">
                <div className="inline-flex items-center gap-2 text-sm font-medium text-[color:var(--ink)]">
                  <Filter className="size-4 text-amber-500" />
                  {t("sections.rules")}
                </div>
                <CardDescription className="text-[color:var(--ink-3)]">
                  {t("subtitle")}
                </CardDescription>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <div className="inline-flex rounded-2xl border border-[color:var(--hairline)] bg-[color:var(--window-bg)] p-1">
                  {(["all", "allow", "deny"] as const).map((item) => (
                    <Button
                      key={item}
                      type="button"
                      variant={filter === item ? "secondary" : "ghost"}
                      size="sm"
                      className="rounded-2xl"
                      onClick={() => setFilter(item)}
                    >
                      {t(`filters.${item}`)}
                    </Button>
                  ))}
                </div>
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("filters.searchPlaceholder")}
                  className="min-w-[260px]"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center gap-3 rounded-2xl border border-dashed border-[color:var(--hairline)] p-6 text-sm text-[color:var(--ink-3)]">
                <Loader2 className="size-4 animate-spin" />
                Loading...
              </div>
            ) : explicitRules.length === 0 ? (
              <EmptyState>{t("empty.rules")}</EmptyState>
            ) : (
              <div className="grid gap-4 xl:grid-cols-2">
                {explicitRules.map((rule) => {
                  const sourceKey = classifyRuleSource(rule)
                  const isDeny = rule.action === "deny_always"

                  return (
                    <Card
                      key={rule.key}
                      className="border-[color:var(--hairline)] bg-[color:var(--panel-bg)]/82 shadow-[var(--ios-button-shadow-soft)]"
                    >
                      <CardHeader className="gap-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="space-y-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <SourceBadge tone={isDeny ? "deny" : "allow"}>
                                {t(`source.${sourceKey}`)}
                              </SourceBadge>
                              <SourceBadge tone={rule.auto_promoted ? "learning" : "info"}>
                                {rule.risk_level ?? "LOW"}
                              </SourceBadge>
                            </div>
                            <div>
                              <CardTitle className="text-lg">{rule.display_label}</CardTitle>
                              <CardDescription className="mt-1 text-xs text-[color:var(--ink-3)]">
                                {rule.tool_name}
                              </CardDescription>
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
                              <Loader2 className="mr-2 size-4 animate-spin" />
                            ) : (
                              <Trash2 className="mr-2 size-4" />
                            )}
                            {t("actions.removeRule")}
                          </Button>
                        </div>
                      </CardHeader>

                      <CardContent className="space-y-4">
                        <div className="grid gap-3 md:grid-cols-2">
                          <Card className="border-[color:var(--hairline)] bg-[color:var(--window-bg)]/80 shadow-none">
                            <CardContent className="p-3">
                              <div className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--ink-3)]">
                                {getOperationLabel(rule.operation_class)}
                              </div>
                              <div className="mt-2 text-sm text-[color:var(--ink-2)]">
                                {getTargetLabel(rule.target_class)} ·{" "}
                                {getBoundaryLabel(rule.boundary_class)}
                              </div>
                            </CardContent>
                          </Card>

                          <Card className="border-[color:var(--hairline)] bg-[color:var(--window-bg)]/80 shadow-none">
                            <CardContent className="p-3">
                              <div className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--ink-3)]">
                                {t("meta.expires")}
                              </div>
                              <div className="mt-2 text-sm text-[color:var(--ink-2)]">
                                {rule.expires_at_unix_ms
                                  ? formatDate(rule.expires_at_unix_ms)
                                  : t("meta.never")}
                              </div>
                            </CardContent>
                          </Card>
                        </div>

                        <div className="grid gap-2 text-xs text-[color:var(--ink-3)] md:grid-cols-2">
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
                          <div>{t("meta.halfLife", { days: rule.half_life_days })}</div>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <Card className="border-[color:var(--hairline)] bg-[color:var(--panel-bg)] shadow-none">
            <CardHeader>
              <div className="inline-flex items-center gap-2 text-sm font-medium text-[color:var(--ink)]">
                <BrainCircuit className="size-4 text-sky-500" />
                {t("sections.learning")}
              </div>
              <CardDescription className="text-[color:var(--ink-3)]">
                {t("learning.description")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {summaryRows.length === 0 ? (
                <EmptyState>{t("empty.learning")}</EmptyState>
              ) : (
                <div className="space-y-3">
                  {summaryRows.map((row) => {
                    const status = getLearningStatus(row)
                    return (
                      <Card
                        key={`${row.operation_class}-${row.target_class}-${row.boundary_class}`}
                        className="border-[color:var(--hairline)] bg-[color:var(--window-bg)]/80 shadow-none"
                      >
                        <CardContent className="space-y-4 p-4">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <div className="text-sm font-semibold text-[color:var(--ink)]">
                                {getOperationLabel(row.operation_class)} ·{" "}
                                {getTargetLabel(row.target_class)}
                              </div>
                              <div className="mt-1 text-xs text-[color:var(--ink-3)]">
                                {getBoundaryLabel(row.boundary_class)}
                              </div>
                            </div>
                            <SourceBadge
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
                            </SourceBadge>
                          </div>

                          <div className="grid gap-2 text-xs text-[color:var(--ink-3)] sm:grid-cols-2">
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
                                row.last_approved_at_unix_ms ?? row.last_rejected_at_unix_ms,
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-rose-500/20 bg-rose-50/40 shadow-none dark:bg-rose-950/10">
            <CardHeader>
              <div className="inline-flex items-center gap-2 text-sm font-medium text-[color:var(--ink)]">
                <AlertTriangle className="size-4 text-rose-500" />
                {t("sections.danger")}
              </div>
              <CardDescription className="text-[color:var(--ink-3)]">
                {t("danger.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <DangerActionCard
                icon={<Sparkles className="size-4 text-amber-500" />}
                title={t("actions.resetLearning")}
                description={t("danger.resetLearningHelp")}
                actionLabel={t("actions.resetLearning")}
                disabled={busyKey === "reset-learning"}
                onClick={() => setConfirmAction("reset-learning")}
              />
              <DangerActionCard
                icon={<ShieldCheck className="size-4 text-sky-500" />}
                title={t("actions.clearAllows")}
                description={t("danger.clearAllowsHelp")}
                actionLabel={t("actions.clearAllows")}
                disabled={busyKey === "clear-allow"}
                onClick={() => setConfirmAction("clear-allow")}
              />
              <DangerActionCard
                icon={<AlertTriangle className="size-4 text-rose-500" />}
                title={t("actions.clearAll")}
                description={t("danger.clearAllHelp")}
                actionLabel={t("actions.clearAll")}
                disabled={busyKey === "clear-all"}
                onClick={() => setConfirmAction("clear-all")}
              />
            </CardContent>
          </Card>
        </div>
      </div>

      <AlertDialog open={confirmAction !== null} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{confirmBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("confirm.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleDangerAction()}>
              {busyKey === confirmAction ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  {t("confirm.confirm")}
                </>
              ) : (
                t("confirm.confirm")
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Container>
  )
}

function DangerActionCard({
  icon,
  title,
  description,
  actionLabel,
  disabled,
  onClick,
}: {
  icon: React.ReactNode
  title: string
  description: string
  actionLabel: string
  disabled: boolean
  onClick: () => void
}) {
  return (
    <Card className="border-[color:var(--hairline)] bg-[color:var(--panel-bg)]/78 shadow-none">
      <CardContent className="space-y-4 p-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex size-9 items-center justify-center rounded-2xl bg-[color:var(--window-bg)]">
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-[color:var(--ink)]">{title}</div>
            <div className="mt-1 text-xs leading-6 text-[color:var(--ink-3)]">
              {description}
            </div>
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          className="w-full justify-center"
          disabled={disabled}
          onClick={onClick}
        >
          {disabled ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
          {actionLabel}
        </Button>
      </CardContent>
    </Card>
  )
}
