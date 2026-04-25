"use client"

import { FolderOpen, FolderSearch, RefreshCw, ShieldCheck } from "lucide-react"

import { Button } from "@/ui/shadcn/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/ui/shadcn/card"
import { Input } from "@/ui/shadcn/input"
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
  const corpus = state?.corpusStatus
  const candidateFolders: Array<{ relativePath: string }> = []
  const isAdoptMode = bindingMode === "adopt_existing_folder"

  return (
    <Card className="h-full gap-0 py-0 border-[var(--hairline)] bg-[var(--panel-bg)] shadow-sm">
      <CardHeader className="border-b border-[var(--hairline)] pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-sky-600">
              <FolderSearch className="size-3.5" />
              {t("binding.eyebrow")}
            </div>
            <CardTitle className="text-base text-[var(--ink)]">
              {t("binding.title")}
            </CardTitle>
            <CardDescription className="max-w-xl text-sm text-[var(--ink-3)]">
              {t("binding.description")}
            </CardDescription>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            className="rounded-lg border border-[var(--hairline)] bg-[var(--panel-bg-inset)] text-[var(--ink-2)] shadow-sm"
          >
            <RefreshCw className="mr-1.5 size-3.5" />
            {t("binding.refresh")}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-4">
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
            className="h-10 rounded-lg border-white/70 bg-white/75 text-sm"
          />
        </LabeledField>

        {isAdoptMode ? (
          <div className="space-y-3">
            <LabeledField
              label={t("binding.fields.adoptFolder.label")}
              description={t("binding.fields.adoptFolder.description")}
            >
              <Input
                value={adoptFolderRelativePath}
                onChange={(event) => onAdoptFolderRelativePathChange(event.target.value)}
                placeholder={t("binding.fields.adoptFolder.placeholder")}
                className="h-10 rounded-lg border-white/70 bg-white/75 text-sm"
              />
            </LabeledField>

            {candidateFolders.length > 0 ? (
              <div className="rounded-xl border border-white/70 bg-white/78 p-3">
                <div className="text-[11px] font-medium uppercase tracking-[0.1em] text-slate-400">
                  {t("binding.adoption.candidates")}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {candidateFolders.map((folder) => (
                    <button
                      key={folder.relativePath}
                      type="button"
                      onClick={() => onAdoptFolderRelativePathChange(folder.relativePath)}
                      className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-white"
                    >
                      {folder.relativePath}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {adoptionPreview ? (
              <div className="rounded-xl border border-amber-200/70 bg-amber-50/85 p-3 text-sm text-amber-950">
                <div className="font-semibold">{t("binding.adoption.previewTitle")}</div>
                <div className="mt-1.5 leading-5 text-amber-900/85">
                  {adoptionPreview.summaryMessage}
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {adoptionPreview.bucketedCounts.map((bucket) => (
                    <div key={bucket.kind} className="rounded-lg border border-amber-200 bg-white/70 px-3 py-2.5">
                      <div className="text-[11px] font-medium uppercase tracking-[0.1em] text-amber-700">
                        {t(`binding.adoption.buckets.${bucket.kind}`)}
                      </div>
                      <div className="mt-0.5 text-base font-semibold text-amber-950">{bucket.count}</div>
                      {bucket.examples.length > 0 ? (
                        <div className="mt-1 text-xs leading-5 text-amber-900/80">
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
              className="h-10 rounded-lg border-white/70 bg-white/75 text-sm"
            />
          </LabeledField>
        )}

        <div className="grid gap-2 rounded-xl border border-emerald-200/70 bg-emerald-50/80 p-3 text-sm text-emerald-900">
          <div className="flex items-start gap-2.5">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
            <div>
              <div className="font-semibold">
                {t("binding.safety.title")}
              </div>
              <div className="mt-0.5 text-emerald-800/85">
                {t("binding.safety.description")}
              </div>
            </div>
          </div>
        </div>

        {binding && (
          <div className="grid gap-2 rounded-xl border border-white/70 bg-white/78 p-3 sm:grid-cols-2">
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
              value={corpus?.managedWorkspaceNoteCount ?? 0}
            />
            <BindingInsight
              label={t("binding.insights.directories")}
              value={corpus?.indexedNoteCount ?? 0}
            />
          </div>
        )}
      </CardContent>

      <CardFooter className="flex-wrap gap-2 border-t border-[var(--hairline)] pt-4">
        <Button
          onClick={onAnalyze}
          disabled={isAnalyzing || isPreviewingAdoption}
          className="h-9 rounded-lg bg-[linear-gradient(135deg,#0f172a,#1d4ed8)] px-5 text-white"
        >
          {isAnalyzing || isPreviewingAdoption ? (
            <RefreshCw className="mr-1.5 size-3.5 animate-spin" />
          ) : (
            <FolderSearch className="mr-1.5 size-3.5" />
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
            className="h-9 rounded-lg bg-[linear-gradient(135deg,#7c2d12,#d97706)] px-5 text-white"
          >
            {isConfirmingAdoption ? (
              <RefreshCw className="mr-1.5 size-3.5 animate-spin" />
            ) : (
              <FolderOpen className="mr-1.5 size-3.5" />
            )}
            {t("binding.adoption.confirm")}
          </Button>
        ) : null}
      </CardFooter>
    </Card>
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
        "rounded-lg border px-3 py-2.5 text-left transition",
        active
          ? "border-sky-300 bg-sky-50/90"
          : "border-white/70 bg-white/78 hover:bg-white",
      ].join(" ")}
    >
      <div className="text-sm font-semibold text-slate-900">{title}</div>
      <div className="mt-0.5 text-xs leading-4 text-slate-500">{description}</div>
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
    <label className="block space-y-2">
      <div className="space-y-0.5">
        <div className="text-sm font-semibold text-slate-800">{label}</div>
        <div className="text-xs leading-4 text-slate-500">{description}</div>
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
    <div className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2">
      <div className="text-[11px] font-medium uppercase tracking-[0.1em] text-slate-400">
        {label}
      </div>
      <div className="mt-0.5 text-base font-semibold text-slate-900">{value}</div>
    </div>
  )
}
