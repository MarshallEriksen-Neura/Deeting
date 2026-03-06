"use client"

import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import useSWR from "swr"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  fetchAdminSpecLogSessions,
  fetchAdminSpecPlanLogs,
  type SpecExecutionLogItem,
  type SpecPlanItem,
  type SpecWorkerSessionItem,
} from "@/lib/api/admin-dashboard"

function formatDateTime(value: string | null | undefined, locale: string) {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date)
}

function prettyJson(value: unknown) {
  return JSON.stringify(value, null, 2)
}

export function SpecPlanDetailDrawer({
  plan,
  locale,
  onClose,
}: {
  plan: SpecPlanItem | null
  locale: string
  onClose: () => void
}) {
  const t = useTranslations("admin.agentTasksPage")
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null)
  const [logStatusFilter, setLogStatusFilter] = useState("")
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null)

  const { data: logsData, isLoading: logsLoading, error: logsError } = useSWR(
    plan ? ["/api/v1/admin/spec-plans/logs", plan.id, logStatusFilter] : null,
    () =>
      fetchAdminSpecPlanLogs(plan!.id, {
        limit: 100,
        status: logStatusFilter.trim() || undefined,
      })
  )

  const logs = useMemo(() => logsData?.items ?? [], [logsData?.items])

  const { data: sessionsData, isLoading: sessionsLoading, error: sessionsError } = useSWR(
    selectedLogId ? ["/api/v1/admin/spec-logs/sessions", selectedLogId] : null,
    () => fetchAdminSpecLogSessions(selectedLogId!)
  )

  const selectedLog = useMemo(
    () => logs.find((item) => item.id === selectedLogId) ?? null,
    [logs, selectedLogId]
  )
  const sessions = useMemo(() => sessionsData?.items ?? [], [sessionsData?.items])

  const handleCopy = async (value: unknown) => {
    try {
      await navigator.clipboard.writeText(prettyJson(value))
      setCopyFeedback(t("drawer.copy.copied"))
    } catch {
      setCopyFeedback(t("drawer.copy.failed"))
    }
  }

  if (!plan) return null

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 flex h-full w-full max-w-3xl flex-col border-l border-white/10 bg-[var(--surface,#0a0a0f)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/5 px-6 py-4">
          <div>
            <h2 className="text-sm font-semibold text-[var(--foreground)]">{t("drawer.title")}</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">{plan.project_name}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
          >
            <X className="size-4" />
          </Button>
        </div>

        <div className="grid gap-4 border-b border-white/5 px-6 py-4 md:grid-cols-2">
          <div className="text-xs text-[var(--muted)]">
            {t("drawer.fields.planId")}: <span className="font-mono text-[var(--foreground)]">{plan.id}</span>
          </div>
          <div className="text-xs text-[var(--muted)]">
            {t("drawer.fields.user")}: <span className="font-mono text-[var(--foreground)]">{plan.user_id}</span>
          </div>
          <div className="text-xs text-[var(--muted)]">
            {t("drawer.fields.status")}: <span className="text-[var(--foreground)]">{plan.status}</span>
          </div>
          <div className="text-xs text-[var(--muted)]">
            {t("drawer.fields.version")}: <span className="text-[var(--foreground)]">v{plan.version}</span>
          </div>
          <div className="text-xs text-[var(--muted)]">
            {t("drawer.fields.created")}: <span className="text-[var(--foreground)]">{formatDateTime(plan.created_at, locale)}</span>
          </div>
          <div className="text-xs text-[var(--muted)]">
            {t("drawer.fields.updated")}: <span className="text-[var(--foreground)]">{formatDateTime(plan.updated_at, locale)}</span>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 p-6 lg:grid-cols-2">
          <div className="min-h-0 rounded-lg border border-white/10 bg-white/[0.02] p-3">
            <div className="mb-3 text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
              {t("drawer.logsTitle")}
            </div>
            <div className="mb-3 flex items-center gap-2">
              <Input
                value={logStatusFilter}
                onChange={(event) => setLogStatusFilter(event.target.value)}
                placeholder={t("drawer.logStatusPlaceholder")}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLogStatusFilter("")}
                className="shrink-0"
              >
                {t("drawer.clearFilter")}
              </Button>
            </div>
            <div className="max-h-full space-y-2 overflow-y-auto">
              {logsLoading && <p className="text-xs text-[var(--muted)]">{t("drawer.logsLoading")}</p>}
              {logsError && <p className="text-xs text-rose-400">{t("drawer.logsFailed")}</p>}
              {!logsLoading && !logsError && logs.length === 0 && (
                <p className="text-xs text-[var(--muted)]">{t("drawer.logsEmpty")}</p>
              )}
              {logs.map((log: SpecExecutionLogItem) => (
                <button
                  key={log.id}
                  onClick={() => setSelectedLogId(log.id)}
                  className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                    selectedLogId === log.id
                      ? "border-[var(--primary)]/40 bg-[var(--primary)]/10"
                      : "border-white/10 bg-white/[0.02] hover:bg-white/5"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-[var(--foreground)]">{log.node_id}</span>
                    <span className="text-[10px] text-[var(--muted)]">{log.status}</span>
                  </div>
                  <div className="mt-1 text-[10px] text-[var(--muted)]">
                    {formatDateTime(log.created_at, locale)}
                  </div>
                  {log.error_message && (
                    <div className="mt-1 line-clamp-2 text-[10px] text-rose-300">{log.error_message}</div>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 rounded-lg border border-white/10 bg-white/[0.02] p-3">
            <div className="mb-3 text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
              {t("drawer.sessionsTitle")}
            </div>
            {copyFeedback && <p className="mb-2 text-xs text-[var(--muted)]">{copyFeedback}</p>}
            {!selectedLog && <p className="text-xs text-[var(--muted)]">{t("drawer.selectLogHint")}</p>}
            {selectedLog && (
              <div className="space-y-3">
                <div className="rounded-lg border border-white/10 bg-white/[0.02] p-2">
                  <div className="text-[10px] text-[var(--muted)]">{t("drawer.selectedLog")}</div>
                  <div className="mt-1 font-mono text-xs text-[var(--foreground)]">{selectedLog.id}</div>
                </div>

                <details className="rounded-lg border border-white/10 bg-white/[0.02] p-2">
                  <summary className="cursor-pointer text-xs text-[var(--foreground)]">{t("drawer.json.inputSnapshot")}</summary>
                  {selectedLog.input_snapshot ? (
                    <div className="mt-2 space-y-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleCopy(selectedLog.input_snapshot)}
                      >
                        {t("drawer.copy.action")}
                      </Button>
                      <pre className="max-h-48 overflow-auto rounded-lg border border-white/10 bg-black/20 p-2 text-[10px] text-[var(--muted)]">
                        {prettyJson(selectedLog.input_snapshot)}
                      </pre>
                    </div>
                  ) : (
                    <p className="mt-2 text-[10px] text-[var(--muted)]">{t("drawer.json.empty")}</p>
                  )}
                </details>

                <details className="rounded-lg border border-white/10 bg-white/[0.02] p-2">
                  <summary className="cursor-pointer text-xs text-[var(--foreground)]">{t("drawer.json.outputData")}</summary>
                  {selectedLog.output_data ? (
                    <div className="mt-2 space-y-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleCopy(selectedLog.output_data)}
                      >
                        {t("drawer.copy.action")}
                      </Button>
                      <pre className="max-h-48 overflow-auto rounded-lg border border-white/10 bg-black/20 p-2 text-[10px] text-[var(--muted)]">
                        {prettyJson(selectedLog.output_data)}
                      </pre>
                    </div>
                  ) : (
                    <p className="mt-2 text-[10px] text-[var(--muted)]">{t("drawer.json.empty")}</p>
                  )}
                </details>

                <details className="rounded-lg border border-white/10 bg-white/[0.02] p-2">
                  <summary className="cursor-pointer text-xs text-[var(--foreground)]">{t("drawer.json.rawResponse")}</summary>
                  {selectedLog.raw_response != null ? (
                    <div className="mt-2 space-y-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleCopy(selectedLog.raw_response)}
                      >
                        {t("drawer.copy.action")}
                      </Button>
                      <pre className="max-h-48 overflow-auto rounded-lg border border-white/10 bg-black/20 p-2 text-[10px] text-[var(--muted)]">
                        {prettyJson(selectedLog.raw_response)}
                      </pre>
                    </div>
                  ) : (
                    <p className="mt-2 text-[10px] text-[var(--muted)]">{t("drawer.json.empty")}</p>
                  )}
                </details>

                {sessionsLoading && <p className="text-xs text-[var(--muted)]">{t("drawer.sessionsLoading")}</p>}
                {sessionsError && <p className="text-xs text-rose-400">{t("drawer.sessionsFailed")}</p>}
                {!sessionsLoading && !sessionsError && sessions.length === 0 && (
                  <p className="text-xs text-[var(--muted)]">{t("drawer.sessionsEmpty")}</p>
                )}

                <div className="max-h-[420px] space-y-2 overflow-y-auto">
                  {sessions.map((session: SpecWorkerSessionItem) => (
                    <div key={session.id} className="rounded-lg border border-white/10 bg-white/[0.02] p-2">
                      <div className="font-mono text-[10px] text-[var(--foreground)]">{session.id}</div>
                      <div className="mt-1 grid grid-cols-3 gap-2 text-[10px] text-[var(--muted)]">
                        <span>{t("drawer.sessionMetrics.messages", { count: session.internal_messages.length })}</span>
                        <span>{t("drawer.sessionMetrics.thoughts", { count: session.thought_trace.length })}</span>
                        <span>{t("drawer.sessionMetrics.tokens", { count: session.total_tokens })}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
