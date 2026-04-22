"use client"

import { CheckCircle2, FolderTree, RefreshCw } from "lucide-react"

import { Button } from "@/ui/shadcn/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/ui/shadcn/card"
import type { BootstrapLocalLlmWikiWorkspaceResult, LocalLlmWikiState } from "@/lib/api/llm-wiki"

type Translation = (key: string, values?: Record<string, string | number>) => string

const scaffoldPreview = [
  "README-LLM-Wiki.md",
  "AGENTS.md",
  "Home.md",
  "index.md",
  "log.md",
  "raw/clips/",
  "raw/docs/",
  "raw/images/",
  "wiki/entities/",
  "wiki/concepts/",
  "wiki/sources/",
  "wiki/analyses/",
]

export function LlmWikiWorkspaceCard({
  t,
  state,
  bindingMode,
  lastBootstrap,
  isBootstrapping,
  onBootstrap,
}: {
  t: Translation
  state: LocalLlmWikiState | null
  bindingMode: string
  lastBootstrap: BootstrapLocalLlmWikiWorkspaceResult | null
  isBootstrapping: boolean
  onBootstrap: () => void
}) {
  const workspace = state?.workspaceStatus
  const isAdoptMode = bindingMode === "adopt_existing_folder"

  return (
    <Card className="h-full gap-0 py-0 border-[var(--hairline)] bg-[var(--panel-bg)] shadow-[0_18px_40px_-30px_rgba(15,17,28,0.22)]">
      <CardHeader className="border-b border-[var(--hairline)] pb-5">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-700">
            <FolderTree className="size-3.5" />
            {t("workspace.eyebrow")}
          </div>
          <CardTitle className="text-[var(--ink)]">
            {t("workspace.title")}
          </CardTitle>
          <CardDescription className="text-[var(--ink-3)]">
            {t("workspace.description")}
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="space-y-5 pt-6">
        <div className="rounded-[1.75rem] border border-white/70 bg-white/78 p-4 shadow-[0_20px_45px_-32px_rgba(15,23,42,0.32)]">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            {t("workspace.pathLabel")}
          </div>
          <div className="mt-2 break-all text-sm leading-6 text-slate-700">
            {workspace?.resolvedWorkspacePath ?? t("workspace.pathPlaceholder")}
          </div>
        </div>

        <div className="grid gap-2 rounded-[1.75rem] border border-white/70 bg-slate-950/[0.94] p-4 text-slate-100 shadow-[0_28px_70px_-40px_rgba(15,23,42,0.58)]">
          {scaffoldPreview.map((entry) => (
            <div
              key={entry}
              className="flex items-center gap-3 rounded-2xl border border-white/5 bg-white/[0.03] px-3 py-2"
            >
              <CheckCircle2 className="size-4 text-emerald-400" />
              <span className="font-mono text-xs text-slate-200">{entry}</span>
            </div>
          ))}
        </div>

        {workspace && (
          <div className="grid gap-3 sm:grid-cols-3">
            <WorkspaceMetric
              label={t("workspace.metrics.ready")}
              value={workspace.readyFileCount}
            />
            <WorkspaceMetric
              label={t("workspace.metrics.workspace")}
              value={
                workspace.workspaceExists
                  ? t("workspace.metrics.created")
                  : t("workspace.metrics.notCreated")
              }
            />
            <WorkspaceMetric
              label={t("workspace.metrics.bootstrappedAt")}
              value={
                workspace.lastBootstrappedAt ??
                t("workspace.metrics.awaiting")
              }
            />
          </div>
        )}

        {lastBootstrap && (
          <div className="rounded-[1.5rem] border border-emerald-200/70 bg-emerald-50/85 p-4 text-sm text-emerald-950">
            <div className="font-semibold">{t("workspace.lastRun.title")}</div>
            <div className="mt-2 grid gap-2 text-emerald-900/85">
              <div>
                {t("workspace.lastRun.createdFiles", {
                  count: lastBootstrap.createdFiles.length,
                })}
              </div>
              <div>
                {t("workspace.lastRun.createdDirectories", {
                  count: lastBootstrap.createdDirectories.length,
                })}
              </div>
              <div>
                {t("workspace.lastRun.skippedFiles", {
                  count: lastBootstrap.skippedFiles.length,
                })}
              </div>
            </div>
          </div>
        )}
      </CardContent>

      <CardFooter className="flex-wrap gap-3 border-t border-[var(--hairline)] pt-5">
        {isAdoptMode ? (
          <div className="text-sm leading-6 text-slate-500">
            {t("workspace.adoptModeNote")}
          </div>
        ) : (
          <Button
            onClick={onBootstrap}
            disabled={isBootstrapping || !state?.binding}
            className="h-11 rounded-full bg-[linear-gradient(135deg,#065f46,#10b981)] px-6 text-white shadow-[0_20px_40px_-24px_rgba(16,185,129,0.65)]"
          >
            {isBootstrapping ? (
              <RefreshCw className="mr-2 size-4 animate-spin" />
            ) : (
              <FolderTree className="mr-2 size-4" />
            )}
            {isBootstrapping ? t("workspace.bootstrapping") : t("workspace.bootstrap")}
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}

function WorkspaceMetric({
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
      <div className="mt-1 break-all text-sm font-semibold text-slate-900">
        {value}
      </div>
    </div>
  )
}
