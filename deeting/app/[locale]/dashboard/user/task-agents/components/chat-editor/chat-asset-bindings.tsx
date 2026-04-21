"use client"

import { CheckCircle2, FileText } from "lucide-react"
import { Button } from "@/components/ui/shadcn/button"
import { Skeleton } from "@/components/ui/shadcn/skeleton"
import { cn } from "@/lib/utils"
import type { LocalAsset } from "@/lib/api/local-assets"
import type { TaskAgentDraft } from "../task-agent-editor-types"
import { BindingPanel } from "./binding-panel"

type Translation = (key: string, values?: Record<string, string | number>) => string

type ChatAssetBindingsProps = {
  t: Translation
  draft: TaskAgentDraft
  localAssets: LocalAsset[]
  assetsLoading: boolean
  updateDraft: <K extends keyof TaskAgentDraft>(key: K, value: TaskAgentDraft[K]) => void
}

export function ChatAssetBindings({
  t,
  draft,
  localAssets,
  assetsLoading,
  updateDraft,
}: ChatAssetBindingsProps) {
  const bindableAssets = localAssets.filter(
    (asset) => asset.asset_kind === "html_asset" && !asset.is_archived,
  )

  return (
    <BindingPanel
      title={t("bindings.assetTitle")}
      description={t("bindings.assetDescription")}
      count={draft.bound_asset_id ? 1 : 0}
      scrollHeight="h-[240px]"
      headerAction={
        draft.bound_asset_id ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => updateDraft("bound_asset_id", "")}
            className="h-7 rounded-lg px-2.5 text-[10px] font-bold uppercase tracking-wider"
          >
            {t("bindings.clearAsset")}
          </Button>
        ) : null
      }
    >
      <div className="space-y-2">
        {assetsLoading ? (
          Array.from({ length: 3 }).map((_, index) => (
            <div
              key={`asset-skeleton-${index}`}
              className="space-y-2 rounded-xl border border-[var(--hairline)] bg-[var(--panel-bg)]/40 p-3"
            >
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-full" />
            </div>
          ))
        ) : bindableAssets.length === 0 ? (
          <p className="py-8 text-center text-xs text-[var(--muted)]">
            {t("bindings.noAssets")}
          </p>
        ) : (
          bindableAssets.map((asset) => {
            const isSelected = draft.bound_asset_id === asset.asset_id
            return (
              <button
                key={asset.asset_id}
                type="button"
                onClick={() =>
                  updateDraft("bound_asset_id", isSelected ? "" : asset.asset_id)
                }
                className={cn(
                  "group w-full rounded-xl border p-3 text-left transition-all",
                  isSelected
                    ? "border-[var(--accent-border)] bg-[var(--accent-soft)] shadow-sm"
                    : "border-[var(--hairline)] bg-[var(--panel-bg)]/40 hover:bg-[var(--panel-bg)]/70 hover:border-[var(--hairline-strong)]",
                )}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-lg",
                      isSelected
                        ? "bg-[var(--accent-strong)] text-white"
                        : "bg-[var(--panel-bg-inset)] text-[var(--ink-3)]",
                    )}
                  >
                    {isSelected ? (
                      <CheckCircle2 className="size-4" />
                    ) : (
                      <FileText className="size-4" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="ws-control text-sm font-bold truncate text-[var(--ink-1)]">
                      {asset.title}
                    </p>
                    <p className="ws-body text-xs opacity-70 line-clamp-2 leading-snug">
                      {asset.summary || asset.render_hint || asset.asset_id}
                    </p>
                    <p className="ws-num text-[10px] tabular-nums opacity-40">
                      {asset.asset_id}
                    </p>
                  </div>
                </div>
              </button>
            )
          })
        )}
      </div>
    </BindingPanel>
  )
}
