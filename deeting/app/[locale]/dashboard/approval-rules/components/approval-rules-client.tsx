"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import {
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  ChevronRight,
  Clock,
  Filter,
  Loader2,
  Monitor,
  Search,
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
import { cn } from "@/lib/utils"
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
import { Input } from "@/components/ui/shadcn/input"
import { Container } from "@/components/ui/common/container"
import { GlassButton } from "@/components/ui/common/glass-button"
import {
  GlassCard,
  GlassCardContent,
  GlassCardDescription,
  GlassCardHeader,
  GlassCardTitle,
} from "@/components/ui/common/glass-card"

type RuleFilter = "all" | "allow" | "deny"
type ConfirmAction = null | "clear-all" | "clear-allow" | "reset-learning"
type ApprovalClassLabels = Record<string, string>
type TabKey = "explicit" | "learning" | "logs"

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
  className,
}: {
  tone: "allow" | "deny" | "info" | "learning"
  children: React.ReactNode
  className?: string
}) {
  const toneClass = {
    allow: "border-[var(--ok-border)] bg-[var(--ok-soft)] text-[var(--ok)]",
    deny: "border-[var(--danger-border)] bg-[var(--danger-soft)] text-[var(--danger)]",
    learning: "border-[var(--warn-border)] bg-[var(--warn-soft)] text-[var(--warn)]",
    info: "border-[var(--info-border)] bg-[var(--info-soft)] text-[var(--info)]",
  } satisfies Record<"allow" | "deny" | "info" | "learning", string>

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
        toneClass[tone],
        className
      )}
    >
      {children}
    </span>
  )
}

function EmptyState({
  icon: Icon,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-[var(--r-12)] border border-dashed border-[var(--hairline)] bg-[var(--panel-bg)]/45 px-6 py-10 text-center">
      <div className="flex size-11 items-center justify-center rounded-full bg-[var(--panel-bg)] text-[var(--ink-3)]">
        <Icon className="size-5" />
      </div>
      <p className="max-w-md text-sm leading-6 text-[var(--ink-2)]">{children}</p>
    </div>
  )
}

function StatPill({
  icon: Icon,
  value,
  label,
  colorClass,
}: {
  icon: React.ComponentType<{ className?: string }>
  value: string | number
  label: string
  colorClass: string
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[var(--r-12)] border border-[var(--hairline)] bg-[var(--panel-bg)]/60 py-4 px-3 text-center">
      <Icon className={cn("size-5 mb-2", colorClass)} />
      <span className="text-2xl font-bold text-[var(--ink)] leading-none">{value}</span>
      <span className="mt-1.5 text-[11px] text-[var(--ink-3)]">{label}</span>
    </div>
  )
}

function LearningTable({
  rows,
  getOperationLabel,
  getTargetLabel,
  getBoundaryLabel,
  t,
  maxRows,
}: {
  rows: ToolApprovalLearningSummaryRow[]
  getOperationLabel: (v: string) => string
  getTargetLabel: (v: string) => string
  getBoundaryLabel: (v: string) => string
  t: (key: string, values?: Record<string, unknown>) => string
  maxRows?: number
}) {
  const displayRows = maxRows ? rows.slice(0, maxRows) : rows

  return (
    <div className="overflow-hidden rounded-[var(--r-10)] border border-[var(--hairline)]">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-[var(--hairline)] bg-[var(--panel-bg)]/50 text-[var(--ink-3)]">
            <th className="px-3 py-2.5 font-medium">{t("learning.table.signalDesc")}</th>
            <th className="px-3 py-2.5 font-medium text-center">{t("learning.table.approvals")}</th>
            <th className="px-3 py-2.5 font-medium text-center">{t("learning.table.autoPromoted")}</th>
            <th className="px-3 py-2.5 font-medium text-center">{t("learning.table.explicitAllow")}</th>
            <th className="px-3 py-2.5 font-medium text-center">{t("learning.table.explicitDeny")}</th>
            <th className="px-3 py-2.5 font-medium">{t("learning.table.lastUpdated")}</th>
            <th className="px-3 py-2.5 font-medium text-right">{t("learning.table.status")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--hairline)]">
          {displayRows.map((row) => {
            const status = getLearningStatus(row)
            const statusTone =
              status === "autoPromoted"
                ? "learning"
                : status === "stable"
                ? "info"
                : status === "learning"
                ? "allow"
                : "deny"
            return (
              <tr
                key={`${row.operation_class}-${row.target_class}-${row.boundary_class}`}
                className="hover:bg-[var(--panel-bg)]/30 transition-colors"
              >
                <td className="px-3 py-2.5">
                  <div className="font-medium text-[var(--ink)]">
                    {getOperationLabel(row.operation_class)} · {getTargetLabel(row.target_class)}
                  </div>
                  <div className="text-[var(--ink-3)]">{getBoundaryLabel(row.boundary_class)}</div>
                </td>
                <td className="px-3 py-2.5 text-center text-[var(--ink-2)]">{row.observed_approvals}</td>
                <td className="px-3 py-2.5 text-center text-[var(--ink-2)]">{row.auto_promoted_rules}</td>
                <td className="px-3 py-2.5 text-center text-[var(--ink-2)]">{row.explicit_allow_rules}</td>
                <td className="px-3 py-2.5 text-center text-[var(--ink-2)]">{row.explicit_deny_rules}</td>
                <td className="px-3 py-2.5 text-[var(--ink-2)]">
                  {formatDate(row.last_approved_at_unix_ms ?? row.last_rejected_at_unix_ms)}
                </td>
                <td className="px-3 py-2.5 text-right">
                  <RuleChip tone={statusTone}>{t(`learning.status.${status}`)}</RuleChip>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
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
  const [activeTab, setActiveTab] = React.useState<TabKey>("explicit")

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
  const boundaryFallback =
    boundaryLabels.none ?? boundaryLabels.unknown ?? t("classes.boundary.none")
  const getOperationLabel = (value: string) =>
    resolveApprovalClassLabel(operationLabels, value, operationFallback)
  const getTargetLabel = (value: string) =>
    resolveApprovalClassLabel(targetLabels, value, targetFallback)
  const getBoundaryLabel = (value: string) =>
    resolveApprovalClassLabel(boundaryLabels, value, boundaryFallback)

  const lastUpdated = React.useMemo(() => {
    if (rules.length === 0) return null
    const maxUpdated = Math.max(...rules.map((r) => r.updated_at_unix_ms))
    return formatDate(maxUpdated)
  }, [rules])

  const tabs = [
    { key: "explicit" as const, label: t("sections.rules") },
    { key: "learning" as const, label: t("sections.learning") },
    { key: "logs" as const, label: t("tabs.logs") },
  ]

  return (
    <Container as="main" gutter="md" size="full" className="py-6 md:py-8 !mx-0 !max-w-none">
      <div className="space-y-6">
        {/* Hero */}
        <GlassCard theme="surface" hover="none" padding="lg">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.9fr)] xl:items-center">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-[var(--r-10)] bg-amber-50 text-amber-500">
                  <ShieldCheck className="size-5" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-[var(--ink)]">{t("title")}</h1>
                  <p className="text-sm text-[var(--ink-2)]">{t("subtitle")}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--hairline)] bg-[var(--panel-bg)] px-3 py-1 text-xs text-[var(--ink-2)]">
                  <Monitor className="size-3.5" />
                  {t("desktopOnly")}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--ok-border)] bg-[var(--ok-soft)] px-3 py-1 text-xs text-[var(--ok)]">
                  <CheckCircle2 className="size-3.5" />
                  {t("autoPromoteEnabled")}
                </span>
                {lastUpdated && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--hairline)] bg-[var(--panel-bg)] px-3 py-1 text-xs text-[var(--ink-3)]">
                    <Clock className="size-3.5" />
                    {t("lastUpdated")} {lastUpdated}
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-4 gap-3">
              <StatPill
                icon={ShieldCheck}
                value={summaryStats.active}
                label={t("summary.active")}
                colorClass="text-[var(--info)]"
              />
              <StatPill
                icon={CheckCircle2}
                value={summaryStats.allow}
                label={t("summary.allow")}
                colorClass="text-[var(--ok)]"
              />
              <StatPill
                icon={ShieldOff}
                value={summaryStats.deny}
                label={t("summary.deny")}
                colorClass="text-[var(--danger)]"
              />
              <StatPill
                icon={BrainCircuit}
                value={summaryStats.learning}
                label={t("summary.learning")}
                colorClass="text-[var(--accent-strong)]"
              />
            </div>
          </div>
        </GlassCard>

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-[var(--hairline)]">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "relative px-4 py-2.5 text-sm font-medium transition-colors",
                activeTab === tab.key
                  ? "text-[var(--accent-strong)]"
                  : "text-[var(--ink-3)] hover:text-[var(--ink-2)]"
              )}
            >
              {tab.label}
              {activeTab === tab.key && (
                <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-[var(--accent-strong)]" />
              )}
            </button>
          ))}
        </div>

        {/* Explicit Rules Tab */}
        {activeTab === "explicit" && (
          <div className="space-y-6">
            <GlassCard theme="surface" hover="none">
              {/* Filter bar */}
              <GlassCardHeader className="gap-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between w-full">
                  <div className="flex flex-wrap gap-2">
                    {(["all", "allow", "deny"] as const).map((item) => (
                      <GlassButton
                        key={item}
                        type="button"
                        size="sm"
                        variant={filter === item ? "outline" : "ghost"}
                        onClick={() => setFilter(item)}
                        className={cn(
                          "min-w-[88px]",
                          filter === item
                            ? "border-[var(--accent-border)] text-[var(--accent-strong)] bg-[var(--accent-soft)]"
                            : "text-[var(--ink-2)]"
                        )}
                      >
                        {t(`filters.${item}`)}
                      </GlassButton>
                    ))}
                  </div>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--ink-3)]" />
                    <Input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder={t("filters.searchPlaceholder")}
                      className="w-full min-w-[260px] pl-9 border-[var(--hairline)] bg-[var(--panel-bg)]/65 text-[var(--ink)] placeholder:text-[var(--ink-3)] lg:max-w-sm"
                    />
                  </div>
                </div>
              </GlassCardHeader>

              <GlassCardContent className="pt-0">
                {loading ? (
                  <div className="flex items-center gap-3 rounded-[var(--r-12)] border border-dashed border-[var(--hairline)] bg-[var(--panel-bg)]/45 px-5 py-6 text-sm text-[var(--ink-2)]">
                    <Loader2 className="size-4 animate-spin text-[var(--accent-strong)]" />
                    {t("status.loading")}
                  </div>
                ) : explicitRules.length === 0 ? (
                  <EmptyState icon={Filter}>{t("empty.rules")}</EmptyState>
                ) : (
                  <div className="grid gap-4 xl:grid-cols-2 max-h-[560px] overflow-y-auto pr-1">
                    {explicitRules.map((rule) => {
                      const sourceKey = classifyRuleSource(rule)
                      const isDeny = rule.action === "deny_always"

                      return (
                        <GlassCard
                          key={rule.key}
                          theme="surface"
                          hover="lift"
                          padding="sm"
                          className={cn(
                            "border-[var(--hairline)] bg-[var(--panel-bg)]/68",
                            isDeny && "border-[var(--danger-border)] bg-[var(--danger-soft)]/24"
                          )}
                        >
                          <div className="space-y-3">
                            {/* Top row: tags + delete */}
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <RuleChip tone={isDeny ? "deny" : "allow"}>
                                  {t(`source.${sourceKey}`)}
                                </RuleChip>
                                {rule.risk_level && (
                                  <span
                                    className={cn(
                                      "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
                                      rule.risk_level === "HIGH"
                                        ? "bg-[var(--danger-soft)] text-[var(--danger)]"
                                        : rule.risk_level === "MEDIUM"
                                        ? "bg-[var(--warn-soft)] text-[var(--warn)]"
                                        : "bg-[var(--info-soft)] text-[var(--info)]"
                                    )}
                                  >
                                    {rule.risk_level}
                                  </span>
                                )}
                                <span className="inline-flex items-center rounded-full border border-[var(--hairline)] bg-[var(--panel-bg)] px-2 py-0.5 text-[11px] text-[var(--ink-3)]">
                                  {getBoundaryLabel(rule.boundary_class)}
                                </span>
                              </div>
                              <GlassButton
                                type="button"
                                size="sm"
                                variant="ghost"
                                disabled={busyKey === rule.key}
                                onClick={() => void handleRemoveRule(rule.key)}
                                className="text-[var(--ink-3)] hover:text-[var(--danger)] hover:bg-[var(--danger-soft)]"
                              >
                                {busyKey === rule.key ? (
                                  <Loader2 className="size-4 animate-spin" />
                                ) : (
                                  <Trash2 className="size-4" />
                                )}
                                {t("actions.removeRule")}
                              </GlassButton>
                            </div>

                            {/* Title & tool name */}
                            <div>
                              <h2 className="text-[15px] font-semibold text-[var(--ink)] leading-snug">
                                {rule.display_label}
                              </h2>
                              <p className="mt-0.5 text-xs text-[var(--ink-3)]">{rule.tool_name}</p>
                              <p className="mt-1 text-xs text-[var(--ink-2)]">
                                {getOperationLabel(rule.operation_class)} ·{" "}
                                {getTargetLabel(rule.target_class)} ·{" "}
                                {getBoundaryLabel(rule.boundary_class)}
                              </p>
                            </div>

                            {/* Meta grid */}
                            <div className="grid grid-cols-5 gap-2 rounded-[var(--r-10)] border border-[var(--hairline)] bg-[var(--panel-bg)]/50 p-3">
                              <div>
                                <div className="text-[10px] uppercase tracking-wider text-[var(--ink-3)]">
                                  {t("meta.created")}
                                </div>
                                <div className="mt-1 text-[11px] text-[var(--ink-2)]">
                                  {formatDate(rule.created_at_unix_ms)}
                                </div>
                              </div>
                              <div>
                                <div className="text-[10px] uppercase tracking-wider text-[var(--ink-3)]">
                                  {t("meta.expires")}
                                </div>
                                <div className="mt-1 text-[11px] text-[var(--ink-2)]">
                                  {rule.expires_at_unix_ms
                                    ? formatDate(rule.expires_at_unix_ms)
                                    : t("meta.never")}
                                </div>
                              </div>
                              <div>
                                <div className="text-[10px] uppercase tracking-wider text-[var(--ink-3)]">
                                  {t("meta.approvals")}
                                </div>
                                <div className="mt-1 text-[11px] text-[var(--ink-2)]">
                                  {rule.approve_count}
                                </div>
                              </div>
                              <div>
                                <div className="text-[10px] uppercase tracking-wider text-[var(--ink-3)]">
                                  {t("meta.rejections")}
                                </div>
                                <div className="mt-1 text-[11px] text-[var(--ink-2)]">
                                  {rule.reject_count}
                                </div>
                              </div>
                              <div>
                                <div className="text-[10px] uppercase tracking-wider text-[var(--ink-3)]">
                                  {t("meta.updated")}
                                </div>
                                <div className="mt-1 text-[11px] text-[var(--ink-2)]">
                                  {formatDate(rule.updated_at_unix_ms)}
                                </div>
                              </div>
                            </div>
                          </div>
                        </GlassCard>
                      )
                    })}
                  </div>
                )}
              </GlassCardContent>
            </GlassCard>

            {/* Bottom section: Learning + Danger */}
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]">
              {/* Learning Signals Table */}
              <GlassCard theme="surface" hover="none">
                <GlassCardHeader className="flex-row items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BrainCircuit className="size-4 text-[var(--info)]" />
                    <GlassCardTitle className="text-base">{t("sections.learning")}</GlassCardTitle>
                  </div>
                  <button
                    onClick={() => setActiveTab("learning")}
                    className="inline-flex items-center gap-0.5 text-xs text-[var(--accent-strong)] hover:underline"
                  >
                    {t("learning.viewAll")}
                    <ChevronRight className="size-3" />
                  </button>
                </GlassCardHeader>
                <GlassCardDescription className="px-6 pb-2 text-[var(--ink-2)]">
                  {t("learning.description")}
                </GlassCardDescription>
                <GlassCardContent className="pt-0">
                  {summaryRows.length === 0 ? (
                    <EmptyState icon={BrainCircuit}>{t("empty.learning")}</EmptyState>
                  ) : (
                    <LearningTable
                      rows={summaryRows}
                      getOperationLabel={getOperationLabel}
                      getTargetLabel={getTargetLabel}
                      getBoundaryLabel={getBoundaryLabel}
                      t={t}
                      maxRows={5}
                    />
                  )}
                </GlassCardContent>
              </GlassCard>

              {/* Danger Zone */}
              <GlassCard
                theme="surface"
                hover="none"
                className="border-[var(--danger-border)] bg-[var(--danger-soft)]/18"
              >
                <GlassCardHeader>
                  <div className="flex items-center gap-2 text-sm font-medium text-[var(--ink)]">
                    <AlertTriangle className="size-4 text-[var(--danger)]" />
                    <GlassCardTitle className="text-base">{t("sections.danger")}</GlassCardTitle>
                  </div>
                  <GlassCardDescription className="text-[var(--ink-2)]">
                    {t("danger.description")}
                  </GlassCardDescription>
                </GlassCardHeader>

                <GlassCardContent className="space-y-3 pt-0">
                  <div className="space-y-3 rounded-[var(--r-10)] border border-[var(--hairline)] bg-[var(--panel-bg)]/50 p-3">
                    <div className="flex items-start gap-3">
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-[var(--r-8)] bg-[var(--warn-soft)] text-[var(--warn)]">
                        <Sparkles className="size-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-[var(--ink)]">{t("actions.resetLearning")}</div>
                        <p className="mt-0.5 text-xs leading-5 text-[var(--ink-2)]">
                          {t("danger.resetLearningHelp")}
                        </p>
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <GlassButton
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setConfirmAction("reset-learning")}
                        className="shrink-0"
                      >
                        {t("actions.reset")}
                      </GlassButton>
                    </div>
                  </div>

                  <div className="space-y-3 rounded-[var(--r-10)] border border-[var(--hairline)] bg-[var(--panel-bg)]/50 p-3">
                    <div className="flex items-start gap-3">
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-[var(--r-8)] bg-[var(--ok-soft)] text-[var(--ok)]">
                        <ShieldCheck className="size-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-[var(--ink)]">{t("actions.clearAllows")}</div>
                        <p className="mt-0.5 text-xs leading-5 text-[var(--ink-2)]">
                          {t("danger.clearAllowsHelp")}
                        </p>
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <GlassButton
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setConfirmAction("clear-allow")}
                        className="shrink-0"
                      >
                        {t("actions.clear")}
                      </GlassButton>
                    </div>
                  </div>

                  <div className="space-y-3 rounded-[var(--r-10)] border border-[var(--danger-border)] bg-[var(--danger-soft)]/20 p-3">
                    <div className="flex items-start gap-3">
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-[var(--r-8)] bg-[var(--danger-soft)] text-[var(--danger)]">
                        <ShieldOff className="size-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-[var(--ink)]">{t("actions.clearAll")}</div>
                        <p className="mt-0.5 text-xs leading-5 text-[var(--ink-2)]">
                          {t("danger.clearAllHelp")}
                        </p>
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <GlassButton
                        type="button"
                        size="sm"
                        variant="destructive"
                        onClick={() => setConfirmAction("clear-all")}
                        className="shrink-0"
                      >
                        {t("actions.clearAll")}
                      </GlassButton>
                    </div>
                  </div>
                </GlassCardContent>
              </GlassCard>
            </div>
          </div>
        )}

        {/* Learning Tab */}
        {activeTab === "learning" && (
          <GlassCard theme="surface" hover="none">
            <GlassCardHeader>
              <div className="flex items-center gap-2">
                <BrainCircuit className="size-4 text-[var(--info)]" />
                <GlassCardTitle className="text-base">{t("sections.learning")}</GlassCardTitle>
              </div>
              <GlassCardDescription className="text-[var(--ink-2)]">
                {t("learning.description")}
              </GlassCardDescription>
            </GlassCardHeader>
            <GlassCardContent>
              {summaryRows.length === 0 ? (
                <EmptyState icon={BrainCircuit}>{t("empty.learning")}</EmptyState>
              ) : (
                <LearningTable
                  rows={summaryRows}
                  getOperationLabel={getOperationLabel}
                  getTargetLabel={getTargetLabel}
                  getBoundaryLabel={getBoundaryLabel}
                  t={t}
                />
              )}
            </GlassCardContent>
          </GlassCard>
        )}

        {/* Logs Tab */}
        {activeTab === "logs" && (
          <GlassCard theme="surface" hover="none">
            <GlassCardHeader>
              <div className="flex items-center gap-2">
                <Clock className="size-4 text-[var(--ink-3)]" />
                <GlassCardTitle className="text-base">{t("tabs.logs")}</GlassCardTitle>
              </div>
              <GlassCardDescription className="text-[var(--ink-2)]">
                {t("logs.description")}
              </GlassCardDescription>
            </GlassCardHeader>
            <GlassCardContent>
              <EmptyState icon={Clock}>{t("logs.empty")}</EmptyState>
            </GlassCardContent>
          </GlassCard>
        )}

        {/* Alert Dialog */}
        <AlertDialog
          open={confirmAction !== null}
          onOpenChange={(open) => !open && setConfirmAction(null)}
        >
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
      </div>
    </Container>
  )
}
