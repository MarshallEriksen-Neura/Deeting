"use client"

import { FolderOpen, FolderSearch, RefreshCw, ShieldCheck } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  GlassCard,
  GlassCardContent,
  GlassCardDescription,
  GlassCardFooter,
  GlassCardHeader,
  GlassCardTitle,
} from "@/components/ui/glass-card"
import { Input } from "@/components/ui/input"
import type { LocalLlmWikiAdoptionPreview, LocalLlmWikiState } from "@/lib/api/llm-wiki"

type Translation = (key: string, values?: Record<string, string | number>) => string

export function LlmWikiBindingCard({
  t,
  state,
  vaultRoot,
  workspaceRelativePath,
  bindingMode,
  adoptFolderRelativePath,
  adoptionPreview,
  isAnalyzing,
  isPreviewingAdoption,
  isConfirmingAdoption,
  onVaultRootChange,
  onWorkspaceRelativePathChange,
  onBindingModeChange,
  onAdoptFolderRelativePathChange,
  onAnalyze,
  onConfirmAdoption,
  onRefresh,
}: {
  t: Translation
  state: LocalLlmWikiState | null
  vaultRoot: string
  workspaceRelativePath: string
  bindingMode: string
  adoptFolderRelativePath: string
  adoptionPreview: LocalLlmWikiAdoptionPreview | null
  isAnalyzing: boolean
  isPreviewingAdoption: boolean
  isConfirmingAdoption: boolean
  onVaultRootChange: (value: string) => void
  onWorkspaceRelativePathChange: (value: string) => void
  onBindingModeChange: (value: string) => void
  onAdoptFolderRelativePathChange: (value: string) => void
  onAnalyze: () => void
  onConfirmAdoption: () => void
  onRefresh: () => void
}) {
  const binding = state?.binding
  const scan = state?.scanSummary
  const candidateFolders = scan?.candidateFolders ?? []
  const isAdoptMode = bindingMode === "adopt_existing_folder"

  return (
    <GlassCard
      blur="lg"
      theme="surface"
      hover="none"
      className="h-full border-white/15 bg-[linear-gradient(180deg,rgba(255,255,255,0.84),rgba(245,248,255,0.72))]"
    >
      <GlassCardHeader className="border-b border-white/60 pb-5">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full bg-sky-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-600">
              <FolderSearch className="size-3.5" />
              {t("binding.eyebrow")}
            </div>
            <GlassCardTitle className="text-slate-900">
              {t("binding.title")}
            </GlassCardTitle>
            <GlassCardDescription className="max-w-xl text-slate-500">
              {t("binding.description")}
            </GlassCardDescription>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            className="rounded-full border border-white/65 bg-white/70 text-slate-600 shadow-sm"
          >
            <RefreshCw className="mr-2 size-4" />
            {t("binding.refresh")}
          </Button>
        </div>
      </GlassCardHeader>

      <GlassCardContent className="space-y-5 pt-6">
        <div className="grid gap-2 sm:grid-cols-2">
          <ModeButton
            active={!isAdoptMode}
            title={t("binding.modes.managed.title")}
            description={t("binding.modes.managed.description")}
            onClick={() => onBindingModeChange("managed_workspace")}
          />
          <ModeButton
            active={isAdoptMode}
            title={t("binding.modes.adopt.title")}
            description={t("binding.modes.adopt.description")}
            onClick={() => onBindingModeChange("adopt_existing_folder")}
          />
        </div>

        <LabeledField
          label={t("binding.fields.vaultRoot.label")}
          description={t("binding.fields.vaultRoot.description")}
        >
          <Input
            value={vaultRoot}
            onChange={(event) => onVaultRootChange(event.target.value)}
            placeholder={t("binding.fields.vaultRoot.placeholder")}
            className="h-12 rounded-2xl border-white/70 bg-white/75 text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]"
          />
        </LabeledField>

        {isAdoptMode ? (
          <div className="space-y-4">
            <LabeledField
              label={t("binding.fields.adoptFolder.label")}
              description={t("binding.fields.adoptFolder.description")}
            >
              <Input
                value={adoptFolderRelativePath}
                onChange={(event) => onAdoptFolderRelativePathChange(event.target.value)}
                placeholder={t("binding.fields.adoptFolder.placeholder")}
                className="h-12 rounded-2xl border-white/70 bg-white/75 text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]"
              />
            </LabeledField>

            {candidateFolders.length > 0 ? (
              <div className="rounded-[1.5rem] border border-white/70 bg-white/78 p-4 shadow-[0_20px_45px_-32px_rgba(15,23,42,0.32)]">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                  {t("binding.adoption.candidates")}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {candidateFolders.map((folder) => (
                    <button
                      key={folder.relativePath}
                      type="button"
                      onClick={() => onAdoptFolderRelativePathChange(folder.relativePath)}
                      className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-white"
                    >
                      {folder.relativePath}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {adoptionPreview ? (
              <div className="rounded-[1.5rem] border border-amber-200/70 bg-amber-50/85 p-4 text-sm text-amber-950">
                <div className="font-semibold">{t("binding.adoption.previewTitle")}</div>
                <div className="mt-2 leading-6 text-amber-900/85">
                  {adoptionPreview.summaryMessage}
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {adoptionPreview.bucketedCounts.map((bucket) => (
                    <div key={bucket.kind} className="rounded-2xl border border-amber-200 bg-white/70 px-3 py-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-700">
                        {t(`binding.adoption.buckets.${bucket.kind}`)}
                      </div>
                      <div className="mt-1 text-base font-semibold text-amber-950">{bucket.count}</div>
                      {bucket.examples.length > 0 ? (
                        <div className="mt-2 text-xs leading-5 text-amber-900/80">
                          {bucket.examples.join(" / ")}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <LabeledField
            label={t("binding.fields.workspacePath.label")}
            description={t("binding.fields.workspacePath.description")}
          >
            <Input
              value={workspaceRelativePath}
              onChange={(event) =>
                onWorkspaceRelativePathChange(event.target.value)
              }
              placeholder={t("binding.fields.workspacePath.placeholder")}
              className="h-12 rounded-2xl border-white/70 bg-white/75 text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]"
            />
          </LabeledField>
        )}

        <div className="grid gap-3 rounded-[1.5rem] border border-emerald-200/70 bg-emerald-50/80 p-4 text-sm text-emerald-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
            <div>
              <div className="font-semibold">
                {t("binding.safety.title")}
              </div>
              <div className="mt-1 text-emerald-800/85">
                {t("binding.safety.description")}
              </div>
            </div>
          </div>
        </div>

        {binding && scan && (
          <div className="grid gap-3 rounded-[1.75rem] border border-white/70 bg-white/78 p-4 shadow-[0_20px_45px_-32px_rgba(15,23,42,0.32)] sm:grid-cols-2">
            <BindingInsight
              label={t("binding.insights.vaultName")}
              value={binding.vaultName}
            />
            <BindingInsight
              label={t("binding.insights.obsidian")}
              value={
                binding.isProbableObsidianVault
                  ? t("binding.insights.detected")
                  : t("binding.insights.notDetected")
              }
            />
            <BindingInsight
              label={t("binding.insights.candidates")}
              value={scan.candidateFolders.length}
            />
            <BindingInsight
              label={t("binding.insights.directories")}
              value={scan.totalDirectories}
            />
          </div>
        )}
      </GlassCardContent>

      <GlassCardFooter className="border-t border-white/60 pt-5">
        <Button
          onClick={onAnalyze}
          disabled={isAnalyzing || isPreviewingAdoption}
          className="h-11 rounded-full bg-[linear-gradient(135deg,#0f172a,#1d4ed8)] px-6 text-white shadow-[0_20px_40px_-24px_rgba(29,78,216,0.65)]"
        >
          {isAnalyzing || isPreviewingAdoption ? (
            <RefreshCw className="mr-2 size-4 animate-spin" />
          ) : (
            <FolderSearch className="mr-2 size-4" />
          )}
          {isAdoptMode
            ? isPreviewingAdoption
              ? t("binding.adoption.previewing")
              : t("binding.adoption.preview")
            : isAnalyzing
              ? t("binding.analyzing")
              : t("binding.analyze")}
        </Button>
        {isAdoptMode ? (
          <Button
            onClick={onConfirmAdoption}
            disabled={isConfirmingAdoption || !adoptionPreview?.canAdopt}
            className="h-11 rounded-full bg-[linear-gradient(135deg,#7c2d12,#d97706)] px-6 text-white shadow-[0_20px_40px_-24px_rgba(217,119,6,0.55)]"
          >
            {isConfirmingAdoption ? (
              <RefreshCw className="mr-2 size-4 animate-spin" />
            ) : (
              <FolderOpen className="mr-2 size-4" />
            )}
            {t("binding.adoption.confirm")}
          </Button>
        ) : null}
      </GlassCardFooter>
    </GlassCard>
  )
}

function ModeButton({
  active,
  title,
  description,
  onClick,
}: {
  active: boolean
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-[1.25rem] border px-4 py-3 text-left transition",
        active
          ? "border-sky-300 bg-sky-50/90 shadow-[0_18px_30px_-24px_rgba(14,165,233,0.35)]"
          : "border-white/70 bg-white/78 hover:bg-white",
      ].join(" ")}
    >
      <div className="text-sm font-semibold text-slate-900">{title}</div>
      <div className="mt-1 text-xs leading-5 text-slate-500">{description}</div>
    </button>
  )
}

function LabeledField({
  label,
  description,
  children,
}: {
  label: string
  description: string
  children: React.ReactNode
}) {
  return (
    <label className="block space-y-2.5">
      <div className="space-y-1">
        <div className="text-sm font-semibold text-slate-800">{label}</div>
        <div className="text-xs leading-5 text-slate-500">{description}</div>
      </div>
      {children}
    </label>
  )
}

function BindingInsight({
  label,
  value,
}: {
  label: string
  value: string | number
}) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
        {label}
      </div>
      <div className="mt-1 text-base font-semibold text-slate-900">{value}</div>
    </div>
  )
}
