"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import {
  AlertTriangle,
  BrainCircuit,
  ChevronRight,
  Filter,
  History,
  Info,
  Loader2,
  Lock,
  MoreHorizontal,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Zap,
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
import { Input } from "@/components/ui/shadcn/input"
import { cn } from "@/lib/utils"

/* ─── 原子组件 (Swiss Style) ────────────────────────────────────────────── */

/**
 * 刚性标签：用于展示分类、元数据
 */
function RigidTag({ 
  children, 
  variant = "default",
  className 
}: { 
  children: React.ReactNode, 
  variant?: "default" | "ok" | "warn" | "danger" | "info" | "mono",
  className?: string
}) {
  const variants = {
    default: "bg-[color:var(--secondary)] text-[color:var(--ink-2)]",
    ok: "bg-[color:var(--ok-soft)] text-[color:var(--ok)] border-[color:var(--ok-border)]",
    warn: "bg-[color:var(--warn-soft)] text-[color:var(--warn)] border-[color:var(--warn-border)]",
    danger: "bg-[color:var(--danger-soft)] text-[color:var(--danger)] border-[color:var(--danger-border)]",
    info: "bg-[color:var(--info-soft)] text-[color:var(--info)] border-[color:var(--info-border)]",
    mono: "font-mono bg-[color:var(--hairline-subtle)] text-[color:var(--ink-3)] uppercase tracking-wider"
  }

  return (
    <span className={cn(
      "inline-flex items-center px-2 py-0.5 text-[10px] font-bold border leading-none uppercase tracking-[0.08em] rounded-sm",
      variants[variant],
      className
    )}>
      {children}
    </span>
  )
}

/**
 * 机械网格容器
 */
function GridPanel({ children, className, title, action }: { children: React.ReactNode, className?: string, title?: string, action?: React.ReactNode }) {
  return (
    <div className={cn("border border-[color:var(--hairline)] bg-[color:var(--panel-bg)]", className)}>
      {title && (
        <div className="flex h-10 items-center justify-between border-b border-[color:var(--hairline)] px-4">
          <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-[color:var(--ink-3)]">
            {title}
          </h3>
          {action}
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  )
}

/**
 * 指标卡片 (Swiss Data Block)
 */
function MetricBlock({ label, value, subValue }: { label: string, value: string | number, subValue?: string }) {
  return (
    <div className="flex flex-col border-r border-[color:var(--hairline)] px-6 py-4 last:border-r-0">
      <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-[color:var(--ink-4)]">
        {label}
      </span>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="font-mono text-3xl font-light tracking-tight text-[color:var(--ink)]">
          {value}
        </span>
        {subValue && (
          <span className="text-xs font-medium text-[color:var(--ink-3)]">
            {subValue}
          </span>
        )}
      </div>
    </div>
  )
}

/* ─── 业务逻辑 ──────────────────────────────────────────────────────────── */

type RuleFilter = "all" | "allow" | "deny"
type ConfirmAction = null | "clear-all" | "clear-allow" | "reset-learning"
type ApprovalClassLabels = Record<string, string>

function formatDate(value?: number | null) {
  if (!value) return "-"
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value))
}

function toApprovalClassLabels(value: unknown): ApprovalClassLabels {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  )
}

function resolveApprovalClassLabel(
  labels: ApprovalClassLabels,
  value: string,
  fallback: string,
) {
  const normalized = value.trim()
  if (!normalized) return fallback
  return labels[normalized] ?? normalized.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
}

export function ApprovalRulesClient() {
  const t = useTranslations("approval-rules")
  const opLabels = React.useMemo(() => toApprovalClassLabels(t.raw("classes.operation")), [t])
  const targetLabels = React.useMemo(() => toApprovalClassLabels(t.raw("classes.target")), [t])
  const boundaryLabels = React.useMemo(() => toApprovalClassLabels(t.raw("classes.boundary")), [t])

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
      toast.error(t("toast.loadFailed"))
    } finally {
      setLoading(false)
    }
  }, [t])

  React.useEffect(() => { reload() }, [reload])

  const filteredRules = React.useMemo(() => {
    return rules.filter((rule) => {
      if (rule.action === "allow_once") return false
      if (filter === "allow" && rule.action === "deny_always") return false
      if (filter === "deny" && rule.action !== "deny_always") return false
      if (!query) return true
      const haystack = [rule.display_label, rule.tool_name].join(" ").toLowerCase()
      return haystack.includes(query.toLowerCase())
    })
  }, [filter, query, rules])

  const handleRemoveRule = async (key: string) => {
    setBusyKey(key)
    try {
      await deleteToolApprovalRule(key)
      toast.success(t("toast.ruleRemoved"))
      await reload()
    } finally {
      setBusyKey(null)
    }
  }

  const handleDangerAction = async () => {
    if (!confirmAction) return
    setBusyKey(confirmAction)
    try {
      if (confirmAction === "clear-all") await clearToolApprovalRules("all")
      else if (confirmAction === "clear-allow") await clearToolApprovalRules("allow")
      else await resetToolApprovalLearning()
      setConfirmAction(null)
      await reload()
      toast.success(t("toast.actionSuccess"))
    } finally {
      setBusyKey(null)
    }
  }

  const stats = React.useMemo(() => ({
    active: rules.filter(r => r.action !== "allow_once").length,
    learning: summaryRows.length,
    denied: rules.filter(r => r.action === "deny_always").length
  }), [rules, summaryRows])

  return (
    <Container as="main" size="full" className="min-h-screen bg-[color:var(--window-bg)] p-0 font-text text-[color:var(--ink)]">
      {/* ─── 顶层导航与标题 ─── */}
      <header className="border-b border-[color:var(--hairline-strong)] bg-[color:var(--panel-bg)]">
        <div className="flex h-16 items-center justify-between px-8">
          <div className="flex items-center gap-6">
            <div className="flex size-10 items-center justify-center bg-[color:var(--ink)] text-[color:var(--panel-bg)]">
              <ShieldCheck className="size-6" />
            </div>
            <div>
              <h1 className="font-display text-2xl font-bold tracking-tighter uppercase">
                Security Policy <span className="text-[color:var(--ink-4)] ml-1 font-light italic">Rules & Intelligence</span>
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <RigidTag variant="info">Desktop Shell Only</RigidTag>
            <RigidTag variant="mono">V2.4</RigidTag>
          </div>
        </div>
        
        {/* ─── 指标概览区 ─── */}
        <div className="flex border-t border-[color:var(--hairline)]">
          <MetricBlock label="Active Rules" value={stats.active} subValue="Explicitly Defined" />
          <MetricBlock label="Learned Objects" value={stats.learning} subValue="AI Synthesized" />
          <MetricBlock label="Block List" value={stats.denied} subValue="Security Threats" />
          <div className="flex flex-1 items-center justify-end px-8">
            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--ink-4)]">System Status</div>
                <div className="text-xs font-semibold text-[color:var(--ok)] flex items-center gap-1.5 justify-end">
                  <span className="size-1.5 rounded-full bg-[color:var(--ok)] animate-pulse" />
                  Protection Active
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-12 gap-px bg-[color:var(--hairline-strong)]">
        {/* ─── 左侧控制面板 (Rule Explorer) ─── */}
        <section className="col-span-8 bg-[color:var(--window-bg)]">
          <div className="sticky top-0 z-10 border-b border-[color:var(--hairline)] bg-[color:var(--window-bg)]/80 p-6 backdrop-blur-md">
            <div className="flex items-end justify-between gap-8">
              <div className="flex-1 space-y-4">
                <div className="flex items-center gap-3">
                  <RigidTag variant="mono">Filter // Explorer</RigidTag>
                  <div className="h-px flex-1 bg-[color:var(--hairline-subtle)]" />
                </div>
                <div className="relative group">
                  <Search className="absolute left-0 top-1/2 size-5 -translate-y-1/2 text-[color:var(--ink-4)] transition-colors group-focus-within:text-[color:var(--primary)]" />
                  <input 
                    className="w-full bg-transparent pl-8 pr-4 text-3xl font-light tracking-tight placeholder:text-[color:var(--ink-4)] focus:outline-none"
                    placeholder="Search security rules..."
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex shrink-0 gap-px border border-[color:var(--hairline)] bg-[color:var(--hairline)]">
                {(["all", "allow", "deny"] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={cn(
                      "px-6 py-2 text-[11px] font-bold uppercase tracking-[0.2em] transition-all",
                      filter === f ? "bg-[color:var(--ink)] text-[color:var(--panel-bg)]" : "bg-[color:var(--panel-bg)] text-[color:var(--ink-3)] hover:text-[color:var(--ink)]"
                    )}
                  >
                    {t(`filters.${f}`)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="p-8">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-32 text-[color:var(--ink-4)]">
                <Loader2 className="size-10 animate-spin" />
                <span className="mt-4 text-[10px] font-bold uppercase tracking-[0.4em]">Deciphering Policies...</span>
              </div>
            ) : filteredRules.length === 0 ? (
              <div className="border border-dashed border-[color:var(--hairline)] p-20 text-center">
                <Info className="mx-auto size-8 text-[color:var(--ink-4)]" />
                <div className="mt-4 text-xs font-medium text-[color:var(--ink-3)]">No rules matching your filter criteria.</div>
              </div>
            ) : (
              <div className="grid gap-6">
                {filteredRules.map((rule) => {
                  const isDeny = rule.action === "deny_always"
                  return (
                    <div key={rule.key} className="group relative border border-[color:var(--hairline)] bg-[color:var(--panel-bg)] transition-all hover:border-[color:var(--hairline-strong)] hover:shadow-xl">
                      <div className="flex">
                        <div className={cn("w-1.5 shrink-0", isDeny ? "bg-[color:var(--danger)]" : "bg-[color:var(--ok)]")} />
                        <div className="flex-1 p-6">
                          <div className="flex items-start justify-between">
                            <div className="space-y-3">
                              <div className="flex items-center gap-3">
                                <RigidTag variant={isDeny ? "danger" : "ok"}>
                                  {isDeny ? "Strict Block" : "Explicit Allow"}
                                </RigidTag>
                                <span className="font-mono text-[10px] text-[color:var(--ink-4)]">ID: {rule.key.slice(0,8)}</span>
                              </div>
                              <h2 className="text-xl font-bold tracking-tight">{rule.display_label}</h2>
                              <div className="flex items-center gap-2 text-xs font-medium text-[color:var(--ink-3)]">
                                <Zap className="size-3.5" />
                                {rule.tool_name}
                              </div>
                            </div>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="size-10 rounded-none border border-transparent hover:border-[color:var(--hairline)] hover:bg-[color:var(--danger-soft)] hover:text-[color:var(--danger)]"
                              onClick={() => handleRemoveRule(rule.key)}
                              disabled={busyKey === rule.key}
                            >
                              {busyKey === rule.key ? <Loader2 className="animate-spin" /> : <Trash2 className="size-4" />}
                            </Button>
                          </div>

                          <div className="mt-8 grid grid-cols-3 gap-8 border-t border-[color:var(--hairline-subtle)] pt-6">
                            <div>
                              <div className="text-[9px] font-black uppercase tracking-[0.2em] text-[color:var(--ink-4)]">Capability Scope</div>
                              <div className="mt-2 text-xs font-bold">{resolveApprovalClassLabel(opLabels, rule.operation_class, "Standard")}</div>
                              <div className="mt-1 font-mono text-[10px] text-[color:var(--ink-3)]">{rule.target_class}</div>
                            </div>
                            <div>
                              <div className="text-[9px] font-black uppercase tracking-[0.2em] text-[color:var(--ink-4)]">Audit Trail</div>
                              <div className="mt-2 flex items-center gap-4">
                                <div className="text-xs">
                                  <span className="text-[color:var(--ink-4)]">Passed:</span> <span className="font-mono font-bold text-[color:var(--ok)]">{rule.approve_count}</span>
                                </div>
                                <div className="text-xs">
                                  <span className="text-[color:var(--ink-4)]">Blocked:</span> <span className="font-mono font-bold text-[color:var(--danger)]">{rule.reject_count}</span>
                                </div>
                              </div>
                            </div>
                            <div>
                              <div className="text-[9px] font-black uppercase tracking-[0.2em] text-[color:var(--ink-4)]">Expiration</div>
                              <div className="mt-2 font-mono text-xs font-bold text-[color:var(--ink-2)]">
                                {rule.expires_at_unix_ms ? formatDate(rule.expires_at_unix_ms) : "PERPETUAL"}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </section>

        {/* ─── 右侧边栏 (AI Intelligence & Danger Zone) ─── */}
        <aside className="col-span-4 flex flex-col gap-px bg-[color:var(--hairline-strong)]">
          <section className="bg-[color:var(--panel-bg)] p-8">
            <div className="flex items-center gap-3">
              <BrainCircuit className="size-5 text-[color:var(--info)]" />
              <h3 className="text-[11px] font-black uppercase tracking-[0.2em]">AI Learning Abstract</h3>
            </div>
            <p className="mt-4 text-xs leading-relaxed text-[color:var(--ink-3)]">
              Synthetic rules generated by observing interactive behavior patterns. These are pending promotion to static rules.
            </p>

            <div className="mt-8 space-y-4">
              {summaryRows.length === 0 ? (
                <div className="border border-dashed border-[color:var(--hairline)] py-12 text-center text-[10px] font-bold uppercase tracking-widest text-[color:var(--ink-4)]">
                  Zero Observations
                </div>
              ) : (
                summaryRows.map((row, idx) => (
                  <div key={idx} className="border border-[color:var(--hairline)] p-4 transition-colors hover:bg-[color:var(--window-bg)]">
                    <div className="flex items-start justify-between">
                      <div className="text-xs font-bold">{resolveApprovalClassLabel(opLabels, row.operation_class, "Behavior")}</div>
                      <RigidTag variant="mono" className="text-[9px]">Learned</RigidTag>
                    </div>
                    <div className="mt-1 font-mono text-[10px] text-[color:var(--ink-3)]">{row.target_class}</div>
                    <div className="mt-4 flex items-center justify-between border-t border-[color:var(--hairline-subtle)] pt-3">
                      <div className="font-mono text-[9px] text-[color:var(--ink-4)]">
                        Confidence: <span className="text-[color:var(--ink)]">88%</span>
                      </div>
                      <div className="flex gap-2">
                         <div className="size-1 bg-[color:var(--info)]" />
                         <div className="size-1 bg-[color:var(--info)]" />
                         <div className="size-1 bg-[color:var(--info)] opacity-30" />
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="bg-[color:var(--panel-bg)] p-8">
            <div className="flex items-center gap-3">
              <History className="size-5 text-[color:var(--warn)]" />
              <h3 className="text-[11px] font-black uppercase tracking-[0.2em]">Compliance Log</h3>
            </div>
            <div className="mt-6 space-y-4">
              <div className="flex items-center gap-3 border-l-2 border-[color:var(--hairline)] pl-4">
                <div className="text-[9px] font-mono text-[color:var(--ink-4)]">14:22:01</div>
                <div className="text-[10px] font-medium text-[color:var(--ink-3)]">System integrity scan completed.</div>
              </div>
              <div className="flex items-center gap-3 border-l-2 border-[color:var(--ok)] pl-4">
                <div className="text-[9px] font-mono text-[color:var(--ink-4)]">12:05:48</div>
                <div className="text-[10px] font-medium text-[color:var(--ink-3)]">New rule promoted: <span className="text-[color:var(--ink)]">FileSystem.Read</span></div>
              </div>
            </div>
          </section>

          <section className="mt-auto bg-[color:var(--panel-bg)] p-8">
            <div className="border border-[color:var(--danger)] p-6">
              <div className="flex items-center gap-3">
                <AlertTriangle className="size-5 text-[color:var(--danger)]" />
                <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-[color:var(--danger)]">Danger Operations</h3>
              </div>
              <div className="mt-6 grid gap-2">
                <Button 
                  variant="outline" 
                  className="h-12 w-full rounded-none border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] text-[color:var(--danger)] hover:bg-[color:var(--danger)] hover:text-white"
                  onClick={() => setConfirmAction("clear-all")}
                  disabled={!!busyKey}
                >
                  PURGE ALL RULES
                </Button>
                <div className="mt-2 text-[9px] leading-relaxed text-[color:var(--ink-4)] uppercase tracking-wider text-center">
                  Irreversible action. Proceed with extreme caution.
                </div>
              </div>
            </div>
          </section>
        </aside>
      </div>

      <AlertDialog open={confirmAction !== null} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <AlertDialogContent className="rounded-none border-2 border-[color:var(--ink)]">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-2xl font-bold uppercase tracking-tighter">Confirmation Required</AlertDialogTitle>
            <AlertDialogDescription className="text-sm leading-relaxed">
              You are about to execute a high-privilege administrative command. This action will modify the security posture of the entire workstation.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-8 flex gap-2">
            <AlertDialogCancel className="rounded-none border-[color:var(--hairline-strong)] px-8 uppercase tracking-widest text-[10px] font-bold">Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={() => void handleDangerAction()}
              className="rounded-none bg-[color:var(--danger)] px-8 uppercase tracking-widest text-[10px] font-bold hover:bg-[color:var(--ink)]"
            >
              Execute Command
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Container>
  )
}
