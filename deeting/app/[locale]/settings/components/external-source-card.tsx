"use client"

import { useEffect, useState } from "react"
import {
  Activity,
  ChevronDown,
  ClipboardList,
  CloudDownload,
  DatabaseZap,
  KeyRound,
  Link2,
  RefreshCcw,
  Trash2,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { useI18n } from "@/hooks/use-i18n"
import {
  acceptExternalExperienceCandidate,
  adoptExternalExperienceCandidate,
  createManualExternalRecord,
  deleteExternalSource,
  listExternalExperienceCandidates,
  listExternalSourceRecords,
  reviewExternalExperienceCandidate,
  syncExternalSource,
  testExternalSource,
  translateExternalRecordsOnce,
  updateExternalSource,
  type CreateManualExternalRecordPayload,
  type ExternalExperienceCandidate,
  type ExternalRawRecord,
  type ExternalSourceRecord,
} from "@/lib/api/external-sources"
import { Button } from "@/ui/shadcn/button"
import { Input } from "@/ui/shadcn/input"
import { Label } from "@/ui/shadcn/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/shadcn/select"
import { Switch } from "@/ui/shadcn/switch"
import { Badge } from "@/ui/shadcn/badge"
import { Separator } from "@/ui/shadcn/separator"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/ui/shadcn/collapsible"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/ui/shadcn/sheet"
import { toast } from "sonner"
import { ManualExternalRecordDialog } from "./manual-external-record-dialog"

const RECORD_DRAWER_LIMIT = 50

interface ExternalSourceCardProps {
  source: ExternalSourceRecord
  onChanged: (source: ExternalSourceRecord) => void
  onDeleted: (sourceId: string) => void
}

function connectorTitle(source: ExternalSourceRecord, t: ReturnType<typeof useI18n>) {
  return t(`ecosystem.connector.${source.connector_type}`)
}

function statusTone(status: ExternalSourceRecord["status"]) {
  switch (status) {
    case "ready":
      return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
    case "syncing":
      return "bg-sky-500/10 text-sky-700 dark:text-sky-300"
    case "error":
      return "bg-rose-500/10 text-rose-700 dark:text-rose-300"
    case "disabled":
      return "bg-muted text-muted-foreground"
    default:
      return "bg-amber-500/10 text-amber-700 dark:text-amber-300"
  }
}

function formatObservedAt(value: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value))
  } catch {
    return String(value)
  }
}

export function ExternalSourceCard({
  source,
  onChanged,
  onDeleted,
}: ExternalSourceCardProps) {
  const t = useI18n("settings")
  const [displayName, setDisplayName] = useState(source.display_name)
  const [baseUrl, setBaseUrl] = useState(source.base_url ?? "")
  const [syncMode, setSyncMode] = useState(source.sync_mode)
  const [syncIntervalMinutes, setSyncIntervalMinutes] = useState(
    String(source.sync_interval_minutes)
  )
  const [isEnabled, setIsEnabled] = useState(source.is_enabled)
  const [apiKey, setApiKey] = useState("")
  const [records, setRecords] = useState<ExternalRawRecord[]>([])
  const [candidates, setCandidates] = useState<ExternalExperienceCandidate[]>([])
  const [isLoadingRecords, setIsLoadingRecords] = useState(false)
  const [isCandidateActionRunning, setIsCandidateActionRunning] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [lastActionMessage, setLastActionMessage] = useState<string | null>(null)
  const [recordsDrawerOpen, setRecordsDrawerOpen] = useState(false)
  const [recordsExpanded, setRecordsExpanded] = useState(false)
  const [selectedRecord, setSelectedRecord] = useState<ExternalRawRecord | null>(null)

  useEffect(() => {
    setDisplayName(source.display_name)
    setBaseUrl(source.base_url ?? "")
    setSyncMode(source.sync_mode)
    setSyncIntervalMinutes(String(source.sync_interval_minutes))
    setIsEnabled(source.is_enabled)
    setApiKey("")
  }, [source])

  useEffect(() => {
    let cancelled = false
    setIsLoadingRecords(true)
    listExternalSourceRecords(source.id, RECORD_DRAWER_LIMIT)
      .then((next) => {
        if (!cancelled) {
          setRecords(next)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRecords([])
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingRecords(false)
        }
      })
    listExternalExperienceCandidates({ sourceId: source.id, limit: RECORD_DRAWER_LIMIT })
      .then((next) => {
        if (!cancelled) {
          setCandidates(next)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCandidates([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [source.id])

  async function refreshRecords() {
    const [nextRecords, nextCandidates] = await Promise.all([
      listExternalSourceRecords(source.id, RECORD_DRAWER_LIMIT),
      listExternalExperienceCandidates({ sourceId: source.id, limit: RECORD_DRAWER_LIMIT }),
    ])
    setRecords(nextRecords)
    setCandidates(nextCandidates)
  }

  async function refreshTranslationAndRecords() {
    await translateExternalRecordsOnce(20)
    await refreshRecords()
  }

  async function handleSave() {
    setIsSaving(true)
    try {
      const updated = await updateExternalSource(source.id, {
        display_name: displayName.trim(),
        base_url: baseUrl.trim() || undefined,
        sync_mode: syncMode,
        sync_interval_minutes: Number.parseInt(syncIntervalMinutes, 10) || 360,
        is_enabled: isEnabled,
        api_key: apiKey.trim() || undefined,
      })
      onChanged(updated)
      setApiKey("")
      setLastActionMessage(t("ecosystem.toast.saved"))
      toast.success(t("ecosystem.toast.saved"))
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("ecosystem.toast.saveFailed")
      setLastActionMessage(message)
      toast.error(message)
    } finally {
      setIsSaving(false)
    }
  }

  async function handleClearCredential() {
    setIsSaving(true)
    try {
      const updated = await updateExternalSource(source.id, {
        clear_api_key: true,
      })
      onChanged(updated)
      setLastActionMessage(t("ecosystem.toast.credentialCleared"))
      toast.success(t("ecosystem.toast.credentialCleared"))
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("ecosystem.toast.saveFailed")
      setLastActionMessage(message)
      toast.error(message)
    } finally {
      setIsSaving(false)
    }
  }

  async function handleTest() {
    setIsTesting(true)
    try {
      const result = await testExternalSource(source.id)
      setLastActionMessage(result.message)
      toast.success(result.message)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("ecosystem.toast.testFailed")
      setLastActionMessage(message)
      toast.error(message)
    } finally {
      setIsTesting(false)
    }
  }

  async function handleSync() {
    setIsSyncing(true)
    try {
      const result = await syncExternalSource(source.id)
      const refreshed = await updateExternalSource(source.id, {})
      onChanged(refreshed)
      await refreshTranslationAndRecords()
      setLastActionMessage(
        t("ecosystem.toast.synced", {
          fetched: result.fetched_count,
          stored: result.stored_count,
        })
      )
      toast.success(
        t("ecosystem.toast.synced", {
          fetched: result.fetched_count,
          stored: result.stored_count,
        })
      )
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("ecosystem.toast.syncFailed")
      setLastActionMessage(message)
      toast.error(message)
    } finally {
      setIsSyncing(false)
    }
  }

  async function handleDelete() {
    setIsDeleting(true)
    try {
      await deleteExternalSource(source.id)
      onDeleted(source.id)
      toast.success(t("ecosystem.toast.deleted"))
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("ecosystem.toast.deleteFailed")
      setLastActionMessage(message)
      toast.error(message)
    } finally {
      setIsDeleting(false)
    }
  }

  async function handleManualImport(payload: CreateManualExternalRecordPayload) {
    await createManualExternalRecord(source.id, payload)
    await refreshTranslationAndRecords()
    const refreshed = await updateExternalSource(source.id, {})
    onChanged(refreshed)
    toast.success(t("ecosystem.toast.manualImported"))
  }

  async function handleCandidateReview(
    candidate: ExternalExperienceCandidate,
    reviewStatus: "approved" | "rejected"
  ) {
    setIsCandidateActionRunning(true)
    try {
      await reviewExternalExperienceCandidate(candidate.id, reviewStatus)
      await refreshRecords()
      toast.success(
        reviewStatus === "approved"
          ? t("ecosystem.toast.candidateApproved")
          : t("ecosystem.toast.candidateRejected")
      )
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("ecosystem.toast.candidateActionFailed")
      )
    } finally {
      setIsCandidateActionRunning(false)
    }
  }

  async function handleCandidateAccept(candidate: ExternalExperienceCandidate) {
    setIsCandidateActionRunning(true)
    try {
      await acceptExternalExperienceCandidate(candidate.id, "llm_wiki")
      await refreshRecords()
      toast.success(t("ecosystem.toast.candidateAccepted"))
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("ecosystem.toast.candidateActionFailed")
      )
    } finally {
      setIsCandidateActionRunning(false)
    }
  }

  async function handleCandidateAdopt(candidate: ExternalExperienceCandidate) {
    setIsCandidateActionRunning(true)
    try {
      await adoptExternalExperienceCandidate(candidate.id, "memory")
      await refreshRecords()
      toast.success(t("ecosystem.toast.candidateAdopted"))
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("ecosystem.toast.candidateActionFailed")
      )
    } finally {
      setIsCandidateActionRunning(false)
    }
  }

  const needsRemoteFields = source.connector_type !== "manual_import"
  const needsCredential = source.auth_mode === "api_key"
  const isBusy = isSaving || isTesting || isSyncing || isDeleting
  const activeRecord = selectedRecord ?? records[0] ?? null
  const activeRecordCandidates = activeRecord
    ? candidates.filter((candidate) => candidate.raw_record_id === activeRecord.id)
    : []

  return (
    <>
      <div className="group relative overflow-hidden rounded-2xl border border-border/50 bg-card shadow-sm transition-all duration-500 hover:shadow-lg hover:shadow-black/[0.03] dark:hover:shadow-black/20">
        {/* subtle top gradient line */}
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-border to-transparent opacity-60" />

        {/* Header */}
        <div className="relative flex flex-wrap items-start justify-between gap-4 border-b border-border/40 bg-gradient-to-br from-muted/40 via-muted/20 to-transparent px-6 py-5">
          <div className="flex items-start gap-4">
            <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500/15 to-indigo-500/10 text-sky-600 shadow-sm ring-1 ring-sky-500/10 dark:from-sky-400/15 dark:to-indigo-400/10 dark:text-sky-400 dark:ring-sky-400/10">
              <DatabaseZap className="h-5 w-5" />
              {source.status === "syncing" && (
                <span className="absolute -right-1 -top-1 flex h-3 w-3">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-sky-500" />
                </span>
              )}
            </div>
            <div className="min-w-0">
              <h3 className="text-[15px] font-semibold leading-snug tracking-tight text-foreground">
                {displayName}
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {connectorTitle(source, t)}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="secondary"
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
                statusTone(source.status),
              )}
            >
              <span
                className={cn(
                  "mr-1.5 inline-block h-1.5 w-1.5 rounded-full",
                  source.status === "ready" && "bg-emerald-500",
                  source.status === "syncing" && "bg-sky-500",
                  source.status === "error" && "bg-rose-500",
                  source.status === "disabled" && "bg-muted-foreground/60",
                )}
              />
              {t(`ecosystem.status.${source.status}`)}
            </Badge>
            <Badge
              variant="outline"
              className="rounded-full border-border/50 px-2.5 py-0.5 text-[11px] font-normal uppercase tracking-wider text-muted-foreground"
            >
              {source.trust_level}
            </Badge>
          </div>
        </div>

        <div className="space-y-6 px-6 py-6">
          {/* Name + Enable */}
          <div className="flex flex-col gap-5 sm:flex-row sm:flex-wrap">
            <div className="min-w-[180px] flex-1 space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t("ecosystem.fields.name")}
              </Label>
              <Input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                disabled={isBusy}
                className="rounded-xl border-border/60 bg-background/80 transition-colors focus-visible:bg-background"
              />
            </div>
            <div className="relative min-w-[240px] flex-1 overflow-hidden rounded-xl border border-border/40 bg-muted/20 px-4 py-3.5 dark:bg-muted/10">
              <div className="absolute inset-y-0 left-0 w-[2px] bg-gradient-to-b from-sky-500/40 to-indigo-500/20" />
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 space-y-0.5">
                  <p className="text-sm font-medium text-foreground">
                    {t("ecosystem.fields.enabled")}
                  </p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {t("ecosystem.fields.enabledHelp")}
                  </p>
                </div>
                <Switch
                  checked={isEnabled}
                  onCheckedChange={setIsEnabled}
                  disabled={isBusy}
                />
              </div>
            </div>
          </div>

          {needsRemoteFields ? (
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t("ecosystem.fields.baseUrl")}
              </Label>
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-muted-foreground/70">
                  <Link2 className="h-4 w-4" />
                </span>
                <Input
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  className="rounded-xl border-border/60 bg-background/80 pl-10 transition-colors focus-visible:bg-background"
                  disabled={isBusy}
                />
              </div>
            </div>
          ) : null}

          {/* Sync mode + interval */}
          <div className="flex flex-col gap-5 sm:flex-row sm:flex-wrap">
            <div className="min-w-[180px] flex-1 space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t("ecosystem.fields.syncMode")}
              </Label>
              <Select
                value={syncMode}
                onValueChange={(value) =>
                  setSyncMode(value as "manual" | "scheduled")
                }
                disabled={isBusy}
              >
                <SelectTrigger className="rounded-xl border-border/60 bg-background/80">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">
                    {t("ecosystem.syncMode.manual")}
                  </SelectItem>
                  <SelectItem value="scheduled">
                    {t("ecosystem.syncMode.scheduled")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[180px] flex-1 space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t("ecosystem.fields.interval")}
              </Label>
              <Input
                type="number"
                min={15}
                step={15}
                value={syncIntervalMinutes}
                onChange={(event) => setSyncIntervalMinutes(event.target.value)}
                disabled={isBusy || syncMode !== "scheduled"}
                className="rounded-xl border-border/60 bg-background/80 transition-colors focus-visible:bg-background"
              />
            </div>
          </div>

          {needsCredential ? (
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t("ecosystem.fields.apiKey")}
              </Label>
              <div className="flex flex-col gap-2 md:flex-row">
                <div className="relative min-w-0 flex-1">
                  <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-muted-foreground/70">
                    <KeyRound className="h-4 w-4" />
                  </span>
                  <Input
                    type="password"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder={
                      source.has_credentials
                        ? t("ecosystem.fields.apiKeyPlaceholderSaved")
                        : t("ecosystem.fields.apiKeyPlaceholder")
                    }
                    className="rounded-xl border-border/60 bg-background/80 pl-10 transition-colors focus-visible:bg-background"
                    disabled={isBusy}
                  />
                </div>
                {source.has_credentials ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleClearCredential}
                    disabled={isBusy}
                    className="rounded-xl"
                  >
                    {t("ecosystem.actions.clearKey")}
                  </Button>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                {source.has_credentials
                  ? t("ecosystem.fields.savedCredential")
                  : t("ecosystem.fields.apiKeyHelp")}
              </p>
            </div>
          ) : null}

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              onClick={handleSave}
              disabled={isBusy}
              className="rounded-xl bg-gradient-to-r from-sky-600 to-indigo-600 text-white shadow-sm transition-all hover:shadow-md hover:brightness-105"
            >
              {isSaving ? t("ecosystem.actions.saving") : t("ecosystem.actions.save")}
            </Button>
            {needsRemoteFields ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleTest}
                  disabled={isBusy}
                  className="rounded-xl border-border/60 bg-background/60"
                >
                  <Activity className="mr-2 h-4 w-4" />
                  {isTesting
                    ? t("ecosystem.actions.testing")
                    : t("ecosystem.actions.test")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleSync}
                  disabled={isBusy}
                  className="rounded-xl border-border/60 bg-background/60"
                >
                  <RefreshCcw
                    className={cn(
                      "mr-2 h-4 w-4",
                      isSyncing && "animate-spin",
                    )}
                  />
                  {isSyncing
                    ? t("ecosystem.actions.syncing")
                    : t("ecosystem.actions.sync")}
                </Button>
              </>
            ) : (
              <ManualExternalRecordDialog onCreate={handleManualImport}>
                <Button
                  type="button"
                  variant="outline"
                  disabled={isBusy}
                  className="rounded-xl border-border/60 bg-background/60"
                >
                  <CloudDownload className="mr-2 h-4 w-4" />
                  {t("ecosystem.actions.addRecord")}
                </Button>
              </ManualExternalRecordDialog>
            )}
            <div className="ml-auto">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1.5 rounded-xl text-rose-600/80 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/30"
                onClick={handleDelete}
                disabled={isBusy}
              >
                <Trash2 className="h-4 w-4" />
                {isDeleting
                  ? t("ecosystem.actions.deleting")
                  : t("ecosystem.actions.delete")}
              </Button>
            </div>
          </div>

          {lastActionMessage ? (
            <p className="text-xs text-muted-foreground transition-opacity">
              {lastActionMessage}
            </p>
          ) : null}

          <Separator className="bg-border/40" />

          {/* Records collapsible */}
          <Collapsible
            open={recordsExpanded}
            onOpenChange={setRecordsExpanded}
          >
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-4 rounded-xl border border-border/40 bg-gradient-to-br from-muted/30 via-muted/10 to-background px-4 py-3.5 text-left transition-all hover:from-muted/40"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <p className="text-sm font-semibold text-foreground">
                      {t("ecosystem.records.title")}
                    </p>
                    <Badge
                      variant="outline"
                      className="rounded-full border-border/50 px-2 py-0 text-[11px] font-normal text-muted-foreground"
                    >
                      {t("ecosystem.records.count", { count: records.length })}
                    </Badge>
                  </div>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    {isLoadingRecords ? (
                      <>
                        <RefreshCcw className="h-3 w-3 animate-spin" />
                        {t("ecosystem.records.loading")}
                      </>
                    ) : source.last_synced_at ? (
                      <>
                        <span className="inline-block h-1 w-1 rounded-full bg-emerald-500" />
                        {t("ecosystem.records.lastSynced", {
                          timestamp: source.last_synced_at,
                        })}
                      </>
                    ) : (
                      t("ecosystem.records.notSynced")
                    )}
                  </p>
                </div>
                <div
                  className={cn(
                    "flex shrink-0 items-center justify-center rounded-lg border border-border/50 bg-background/70 p-1.5 text-muted-foreground transition-transform duration-300",
                    recordsExpanded && "rotate-180",
                  )}
                >
                  <ChevronDown className="h-4 w-4" />
                </div>
              </button>
            </CollapsibleTrigger>

            <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
              <div className="mt-3 space-y-2">
                {isLoadingRecords ? (
                  <div className="flex items-center gap-2 rounded-xl border border-dashed border-border/50 px-4 py-6 text-xs text-muted-foreground">
                    <RefreshCcw className="h-3.5 w-3.5 animate-spin" />
                    {t("ecosystem.records.loading")}
                  </div>
                ) : records.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border/50 px-4 py-6 text-center text-xs text-muted-foreground">
                    {t("ecosystem.records.empty")}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {records.slice(0, 5).map((record) => (
                      <div
                        key={record.id}
                        className="flex items-center justify-between gap-3 rounded-xl border border-border/30 bg-background/60 px-3.5 py-2.5 transition-colors hover:bg-muted/30"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">
                            {record.source_asset_id}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {record.asset_family} · {formatObservedAt(record.observed_at_unix_ms)}
                          </p>
                        </div>
                        <Badge
                          variant="outline"
                          className="shrink-0 rounded-full text-[10px] font-normal"
                        >
                          {record.translation_status}
                        </Badge>
                      </div>
                    ))}
                    {records.length > 5 && (
                      <p className="px-1 text-xs text-muted-foreground">
                        {t("ecosystem.records.andMore", {
                          count: records.length - 5,
                        })}
                      </p>
                    )}
                  </div>
                )}

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setRecordsDrawerOpen(true)}
                  className="w-full rounded-xl border-border/60 bg-background/70"
                >
                  <ClipboardList className="mr-2 h-4 w-4" />
                  {t("ecosystem.records.viewRecords")}
                </Button>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </div>
      <Sheet
        open={recordsDrawerOpen}
        onOpenChange={(open) => {
          setRecordsDrawerOpen(open)
          if (!open) {
            setSelectedRecord(null)
          }
        }}
      >
        <SheetContent
          side="right"
          className="flex h-full max-h-screen w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl"
        >
          <SheetHeader className="shrink-0 border-b border-border/40 px-6 py-5">
            <div>
              <SheetTitle className="flex items-center gap-2 text-base">
                <ClipboardList className="h-4 w-4" />
                {t("ecosystem.records.title")}
              </SheetTitle>
              <SheetDescription className="mt-1">
                {source.last_synced_at
                  ? t("ecosystem.records.lastSynced", {
                      timestamp: source.last_synced_at,
                    })
                  : t("ecosystem.records.notSynced")}
              </SheetDescription>
            </div>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <div className="grid gap-4 lg:grid-cols-[minmax(260px,0.9fr)_minmax(0,1.2fr)]">
              <section className="min-h-0 rounded-2xl border border-border/40 bg-muted/10 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">
                      {t("ecosystem.records.drawerListTitle")}
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("ecosystem.records.drawerDescription")}
                    </p>
                  </div>
                  <Badge variant="outline">
                    {t("ecosystem.records.count", { count: records.length })}
                  </Badge>
                </div>

                {isLoadingRecords ? (
                  <p className="mt-4 text-xs text-muted-foreground">
                    {t("ecosystem.records.loading")}
                  </p>
                ) : records.length === 0 ? (
                  <p className="mt-4 rounded-xl border border-dashed border-border/50 px-4 py-3 text-xs text-muted-foreground">
                    {t("ecosystem.records.empty")}
                  </p>
                ) : (
                  <div className="mt-4 max-h-[calc(100vh-16rem)] space-y-3 overflow-y-auto pr-1">
                    {records.map((record) => {
                      const isActive = activeRecord?.id === record.id
                      return (
                        <button
                          key={record.id}
                          type="button"
                          onClick={() => setSelectedRecord(record)}
                          className={[
                            "w-full rounded-xl border px-4 py-3 text-left transition-colors",
                            isActive
                              ? "border-sky-500/40 bg-sky-500/10"
                              : "border-border/40 bg-background/70 hover:border-border hover:bg-muted/20",
                          ].join(" ")}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="min-w-0 space-y-0.5">
                              <p className="truncate text-sm font-medium text-foreground">
                                {record.source_asset_id}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {record.asset_family} - {formatObservedAt(record.observed_at_unix_ms)}
                              </p>
                            </div>
                            <Badge variant="outline">{record.translation_status}</Badge>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </section>

              <section className="min-w-0 rounded-2xl border border-border/40 bg-background p-4">
                {activeRecord ? (
                  <div className="space-y-4">
                    <div>
                      <h3 className="truncate text-base font-semibold text-foreground">
                        {activeRecord.source_asset_id}
                      </h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {activeRecord.asset_family} - {formatObservedAt(activeRecord.observed_at_unix_ms)}
                      </p>
                    </div>
                    <div className="grid gap-3 rounded-2xl border border-border/40 bg-muted/10 p-4 text-sm md:grid-cols-2">
                      <div>
                        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                          {t("ecosystem.records.assetFamily")}
                        </p>
                        <p className="mt-1 font-medium text-foreground">
                          {activeRecord.asset_family}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                          {t("ecosystem.records.translation")}
                        </p>
                        <p className="mt-1 font-medium text-foreground">
                          {activeRecord.translation_status}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                          {t("ecosystem.records.version")}
                        </p>
                        <p className="mt-1 font-medium text-foreground">
                          {activeRecord.source_version || "-"}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                          {t("ecosystem.records.contentHash")}
                        </p>
                        <p className="mt-1 break-all font-mono text-xs text-foreground">
                          {activeRecord.content_hash}
                        </p>
                      </div>
                    </div>
                    <div>
                      <p className="mb-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                        {t("ecosystem.records.payload")}
                      </p>
                      <pre className="max-h-[52vh] overflow-auto rounded-2xl border border-border/40 bg-muted/10 p-4 text-xs leading-5 text-muted-foreground">
                        {activeRecord.raw_payload_json}
                      </pre>
                    </div>
                    <div>
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                          {t("ecosystem.candidates.title")}
                        </p>
                        <Badge variant="outline">
                          {t("ecosystem.candidates.count", {
                            count: activeRecordCandidates.length,
                          })}
                        </Badge>
                      </div>
                      {activeRecordCandidates.length === 0 ? (
                        <p className="rounded-xl border border-dashed border-border/50 px-4 py-3 text-xs text-muted-foreground">
                          {t("ecosystem.candidates.empty")}
                        </p>
                      ) : (
                        <div className="space-y-3">
                          {activeRecordCandidates.map((candidate) => (
                            <div
                              key={candidate.id}
                              className="rounded-2xl border border-border/40 bg-muted/10 p-4"
                            >
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <h4 className="truncate text-sm font-semibold text-foreground">
                                    {candidate.title}
                                  </h4>
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    {candidate.candidate_kind} - {candidate.validation_status}
                                  </p>
                                </div>
                                <Badge variant="outline">{candidate.review_status}</Badge>
                              </div>
                              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                                {candidate.summary}
                              </p>
                              <div className="mt-4 flex flex-wrap gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={isCandidateActionRunning || candidate.review_status === "accepted"}
                                  onClick={() => handleCandidateReview(candidate, "approved")}
                                >
                                  {t("ecosystem.candidates.approve")}
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={isCandidateActionRunning || candidate.review_status === "accepted"}
                                  onClick={() => handleCandidateReview(candidate, "rejected")}
                                >
                                  {t("ecosystem.candidates.reject")}
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  disabled={
                                    isCandidateActionRunning ||
                                    candidate.review_status === "rejected" ||
                                    candidate.review_status === "accepted"
                                  }
                                  onClick={() => handleCandidateAccept(candidate)}
                                >
                                  {t("ecosystem.candidates.acceptToWiki")}
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={
                                    isCandidateActionRunning ||
                                    candidate.review_status !== "accepted" ||
                                    candidate.adoption_status === "adopted"
                                  }
                                  onClick={() => handleCandidateAdopt(candidate)}
                                >
                                  {t("ecosystem.candidates.adoptForAgent")}
                                </Button>
                              </div>
                              {candidate.accepted_ref ? (
                                <p className="mt-3 break-all text-xs text-muted-foreground">
                                  {t("ecosystem.candidates.acceptedRef", {
                                    ref: candidate.accepted_ref,
                                  })}
                                </p>
                              ) : null}
                              {candidate.adopted_memory_id ? (
                                <p className="mt-2 break-all text-xs text-muted-foreground">
                                  {t("ecosystem.candidates.adoptedMemory", {
                                    id: candidate.adopted_memory_id,
                                  })}
                                </p>
                              ) : candidate.adoption_error ? (
                                <p className="mt-2 break-all text-xs text-rose-600 dark:text-rose-400">
                                  {candidate.adoption_error}
                                </p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="rounded-xl border border-dashed border-border/50 px-4 py-3 text-xs text-muted-foreground">
                    {t("ecosystem.records.empty")}
                  </p>
                )}
              </section>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
