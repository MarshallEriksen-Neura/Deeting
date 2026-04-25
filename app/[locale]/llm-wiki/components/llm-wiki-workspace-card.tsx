"use client"

import { FolderTree, Wrench } from "lucide-react"
import { cn } from "@/lib/utils"
import { GlassCard, GlassCardContent, GlassCardHeader, GlassCardTitle, GlassCardDescription } from "@/components/ui/common/glass-card"
import { GlassButton } from "@/components/ui/common/glass-button"
import type { LocalLlmWikiState, BootstrapLocalLlmWikiWorkspaceResult } from "@/lib/api/llm-wiki"

type Translation = (key: string, values?: Record<string, string | number>) => string

interface WorkspaceCardProps {
  t: Translation
  state: LocalLlmWikiState | null
  isBootstrapping: boolean
  lastBootstrap: BootstrapLocalLlmWikiWorkspaceResult | null
  bootstrap: () => Promise<void>
}

export function WorkspaceCard({
  t,
  state,
  isBootstrapping,
  lastBootstrap,
  bootstrap,
}: WorkspaceCardProps) {
  const ws = state?.workspaceStatus
  const binding = state?.binding
  const isAdopt = binding?.mode === "adopt_existing_folder"
  const readyCount = ws?.readyFileCount ?? 0
  const totalChecks = 8

  const checkpoints = [
    { key: "workspaceExists", label: t("workspace.metrics.workspace") },
    { key: "hasReadme", label: "README" },
    { key: "hasHome", label: "Home" },
    { key: "hasIndex", label: "Index" },
    { key: "hasAgents", label: "Agents" },
    { key: "hasLog", label: "Log" },
    { key: "hasRaw", label: "Raw" },
    { key: "hasWiki", label: "Wiki" },
  ]

  return (
    <GlassCard className="h-full">
      <GlassCardHeader>
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-[var(--r-10)] bg-[var(--info-soft)] text-[var(--info)]">
            <FolderTree className="size-4" />
          </div>
          <div>
            <GlassCardTitle className="text-base">{t("workspace.title")}</GlassCardTitle>
            <GlassCardDescription className="text-xs">{t("workspace.description")}</GlassCardDescription>
          </div>
        </div>
      </GlassCardHeader>

      <GlassCardContent className="space-y-4">
        {/* Status indicator */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--muted)]">{t("workspace.metrics.ready")}</span>
            <span className={cn("text-xs font-semibold", readyCount === totalChecks ? "text-[var(--ok)]" : "text-[var(--warn)]")}>
              {readyCount}/{totalChecks}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[var(--panel-bg)] border border-[var(--hairline)]">
            <div
              className={cn("h-full rounded-full transition-all duration-500", readyCount === totalChecks ? "bg-[var(--ok)]" : "bg-[var(--accent-strong)])"}
              style={{ width: `${(readyCount / totalChecks) * 100}%` }}
            />
          </div>
        </div>

        {/* Checkpoints */}
        <div className="grid grid-cols-2 gap-1.5">
          {checkpoints.map((item) => {
            const active = ws ? (ws as Record<string, boolean>)[item.key] : false
            return (
              <div
                key={item.key}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] transition-colors",
                  active
                    ? "bg-[var(--ok-soft)]/60 text-[var(--ok)] border border-[var(--ok)]/20"
                    : "bg-[var(--panel-bg)]/60 text-[var(--muted)] border border-[var(--hairline)]/50"
                )}
              >
                <div className={cn("size-1.5 rounded-full", active ? "bg-[var(--ok)]" : "bg-[var(--muted)]")} />
                {item.label}
              </div>
            )
          })}
        </div>

        {/* Path */}
        {ws?.resolvedWorkspacePath && (
          <div className="rounded-[var(--r-10)] border border-[var(--hairline)] bg-[var(--panel-bg)]/40 px-3 py-2">
            <p className="text-[11px] text-[var(--muted)]">{t("workspace.pathLabel")}</p>
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
          <p className="text-xs text-[var(--muted)]">{t("workspace.adoptModeNote")}</p>
        )}
      </GlassCardContent>
    </GlassCard>
  )
}
