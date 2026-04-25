"use client"

import { HardDrive, RefreshCw, Search, CheckCircle2, FolderTree, Wrench, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { GlassCard, GlassCardContent } from "@/components/ui/common/glass-card"
import { GlassButton } from "@/components/ui/common/glass-button"
import { Input } from "@/components/ui/shadcn/input"
import { Switch } from "@/components/ui/shadcn/switch"
import type {
  LocalLlmWikiState,
  LocalLlmWikiAdoptionPreview,
  BootstrapLocalLlmWikiWorkspaceResult,
} from "@/lib/api/llm-wiki"

type Translation = (key: string, values?: Record<string, string | number>) => string

interface SetupFormProps {
  t: Translation
  visible: boolean
  onClose: () => void
  // Binding
  vaultRoot: string
  workspaceRelativePath: string
  bindingMode: string
  adoptFolderRelativePath: string
  adoptionPreview: LocalLlmWikiAdoptionPreview | null
  state: LocalLlmWikiState | null
  isAnalyzing: boolean
  isPreviewingAdoption: boolean
  isConfirmingAdoption: boolean
  setVaultRoot: (v: string) => void
  setWorkspaceRelativePath: (v: string) => void
  setBindingMode: (v: string) => void
  setAdoptFolderRelativePath: (v: string) => void
  analyze: () => Promise<void>
  confirmAdoption: () => Promise<void>
  refresh: () => Promise<void>
  // Workspace
  isBootstrapping: boolean
  lastBootstrap: BootstrapLocalLlmWikiWorkspaceResult | null
  bootstrap: () => Promise<void>
}

export function SetupForm({
  t,
  visible,
  onClose,
  vaultRoot,
  workspaceRelativePath,
  bindingMode,
  adoptFolderRelativePath,
  adoptionPreview,
  state,
  isAnalyzing,
  isPreviewingAdoption,
  isConfirmingAdoption,
  setVaultRoot,
  setWorkspaceRelativePath,
  setBindingMode,
  setAdoptFolderRelativePath,
  analyze,
  confirmAdoption,
  refresh,
  isBootstrapping,
  lastBootstrap,
  bootstrap,
}: SetupFormProps) {
  if (!visible) return null

  const binding = state?.binding
  const ws = state?.workspaceStatus
  const isManaged = bindingMode === "managed_workspace"
  const isAdopt = bindingMode === "adopt_existing_folder"
  const readyCount = ws?.readyFileCount ?? 0
  const totalChecks = 8

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-[var(--r-14)] border border-white/10 bg-[var(--card)] shadow-2xl">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 flex size-8 items-center justify-center rounded-full bg-[var(--panel-bg)] text-[var(--ink)] transition-colors hover:bg-[var(--panel-bg)]/80 z-10"
        >
          <X className="size-4" />
        </button>

        <div className="p-6 space-y-6">
          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-[var(--r-10)] bg-[var(--accent-soft)] text-[var(--accent-strong)]">
              <HardDrive className="size-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-[var(--foreground)]">{t("binding.title")}</h2>
              <p className="text-xs text-[var(--ink)]">{t("binding.description")}</p>
            </div>
          </div>

          {/* Vault path */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--foreground)]">{t("binding.fields.vaultRoot.label")}</label>
            <div className="flex gap-2">
              <Input
                value={vaultRoot}
                onChange={(e) => setVaultRoot(e.target.value)}
                placeholder={t("binding.fields.vaultRoot.placeholder")}
                className="h-9 flex-1 rounded-[var(--r-10)] border-[var(--hairline)] bg-[var(--panel-bg)]/50 text-sm"
              />
              <GlassButton variant="secondary" size="sm" onClick={refresh} className="shrink-0">
                <RefreshCw className="size-3.5" />
              </GlassButton>
            </div>
          </div>

          {/* Mode switch */}
          <div className="flex items-center gap-3 rounded-[var(--r-10)] border border-[var(--hairline)] bg-[var(--panel-bg)]/40 p-3">
            <Switch
              checked={isAdopt}
              onCheckedChange={(checked) => setBindingMode(checked ? "adopt_existing_folder" : "managed_workspace")}
            />
            <div className="min-w-0">
              <p className="text-sm font-medium text-[var(--foreground)]">
                {isAdopt ? t("binding.modes.adopt.title") : t("binding.modes.managed.title")}
              </p>
              <p className="text-xs text-[var(--ink)]">
                {isAdopt ? t("binding.modes.adopt.description") : t("binding.modes.managed.description")}
              </p>
            </div>
          </div>

          {/* Workspace or adopt path */}
          {isManaged ? (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--foreground)]">{t("binding.fields.workspacePath.label")}</label>
              <Input
                value={workspaceRelativePath}
                onChange={(e) => setWorkspaceRelativePath(e.target.value)}
                placeholder={t("binding.fields.workspacePath.placeholder")}
                className="h-9 rounded-[var(--r-10)] border-[var(--hairline)] bg-[var(--panel-bg)]/50 text-sm"
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--foreground)]">{t("binding.fields.adoptFolder.label")}</label>
              <Input
                value={adoptFolderRelativePath}
                onChange={(e) => setAdoptFolderRelativePath(e.target.value)}
                placeholder={t("binding.fields.adoptFolder.placeholder")}
                className="h-9 rounded-[var(--r-10)] border-[var(--hairline)] bg-[var(--panel-bg)]/50 text-sm"
              />
            </div>
          )}

          {/* Binding insights */}
          {binding && (
            <div className="grid grid-cols-2 gap-2">
              <Insight label={t("binding.insights.vaultName")} value={binding.vaultName} />
              <Insight
                label={t("binding.insights.obsidian")}
                value={binding.isProbableObsidianVault ? t("binding.insights.detected") : t("binding.insights.notDetected")}
              />
              <Insight label={t("binding.insights.readScope") ?? "Read Scope"} value={binding.readScope} />
              <Insight label={t("binding.insights.writeScope") ?? "Write Scope"} value={binding.writeScope} />
            </div>
          )}

          {/* Adoption preview */}
          {adoptionPreview && (
            <div className="space-y-2 rounded-[var(--r-10)] border border-[var(--info)]/20 bg-[var(--info-soft)]/30 p-3">
              <p className="text-xs font-medium text-[var(--info)]">{t("binding.adoption.previewTitle")}</p>
              <p className="text-xs text-[var(--ink)]">{adoptionPreview.summaryMessage}</p>
              <div className="flex flex-wrap gap-1.5">
                {adoptionPreview.bucketedCounts.map((bucket) => (
                  <span key={bucket.kind} className="rounded-md bg-[var(--panel-bg)]/60 px-2 py-0.5 text-[11px] text-[var(--ink)]">
                    {t(`binding.adoption.buckets.${bucket.kind}` as string)}: {bucket.count}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Analyze / Adopt actions */}
          <div className="flex flex-wrap gap-2">
            {isAdopt && adoptionPreview ? (
              <GlassButton size="sm" onClick={confirmAdoption} loading={isConfirmingAdoption}>
                <CheckCircle2 className="size-3.5" />
                {t("binding.adoption.confirm")}
              </GlassButton>
            ) : isAdopt ? (
              <GlassButton size="sm" onClick={analyze} loading={isPreviewingAdoption}>
                <Search className="size-3.5" />
                {t("binding.adoption.preview")}
              </GlassButton>
            ) : (
              <GlassButton size="sm" onClick={analyze} loading={isAnalyzing}>
                <Search className="size-3.5" />
                {t("binding.analyze")}
              </GlassButton>
            )}
          </div>

          {/* Workspace section (divider) */}
          <div className="border-t border-[var(--hairline)]/50 pt-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex size-10 items-center justify-center rounded-[var(--r-10)] bg-[var(--info-soft)] text-[var(--info)]">
                <FolderTree className="size-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[var(--foreground)]">{t("workspace.title")}</h3>
                <p className="text-xs text-[var(--ink)]">{t("workspace.description")}</p>
              </div>
            </div>

            {/* Readiness bar */}
            <div className="space-y-2 mb-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--ink)]">{t("workspace.metrics.ready")}</span>
                <span className={cn("text-xs font-bold", readyCount === totalChecks ? "text-[var(--ok)]" : "text-[var(--warn)]")}>
                  {readyCount}/{totalChecks}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-[var(--panel-bg)] border border-[var(--hairline)]">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-500",
                    readyCount === totalChecks ? "bg-[var(--ok)]" : "bg-[var(--accent-strong)]"
                  )}
                  style={{ width: `${(readyCount / totalChecks) * 100}%` }}
                />
              </div>
            </div>

            {/* Workspace path */}
            {ws?.resolvedWorkspacePath && (
              <div className="rounded-[var(--r-10)] border border-[var(--hairline)] bg-[var(--panel-bg)]/40 px-3 py-2 mb-4">
                <p className="text-[11px] text-[var(--ink)]">{t("workspace.pathLabel")}</p>
                <p className="truncate text-xs font-mono text-[var(--foreground)]">{ws.resolvedWorkspacePath}</p>
              </div>
            )}

            {/* Bootstrap button */}
            {!isAdopt && (
              <GlassButton
                size="sm"
                onClick={bootstrap}
                loading={isBootstrapping}
                disabled={readyCount === totalChecks}
                variant={readyCount === totalChecks ? "secondary" : "default"}
                className="w-full"
              >
                <Wrench className="size-3.5" />
                {readyCount === totalChecks ? t("workspace.metrics.ready") : t("workspace.bootstrap")}
              </GlassButton>
            )}

            {isAdopt && (
              <p className="text-xs text-[var(--ink)]">{t("workspace.adoptModeNote")}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Insight({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--r-10)] border border-[var(--hairline)] bg-[var(--panel-bg)]/40 px-3 py-2">
      <p className="text-[11px] text-[var(--ink)]">{label}</p>
      <p className="truncate text-xs font-medium text-[var(--foreground)]">{value}</p>
    </div>
  )
}
