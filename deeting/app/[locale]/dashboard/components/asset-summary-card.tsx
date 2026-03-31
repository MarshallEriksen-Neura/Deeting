"use client"

import Link from "next/link"
import { Box, ExternalLink, Pin, Sparkles } from "lucide-react"
import { useTranslations } from "next-intl"

import {
  GlassCard,
  GlassCardContent,
  GlassCardDescription,
  GlassCardHeader,
  GlassCardTitle,
} from "@/components/ui/glass-card"
import { Button } from "@/components/ui/button"
import { useLocalAssets } from "@/lib/swr/use-local-assets"

export function AssetSummaryCard() {
  const t = useTranslations("dashboard.assetsPage")
  const { data, isLoading } = useLocalAssets({ limit: 12 })

  const assets = data ?? []
  const pinnedAssets = assets.filter((asset) => asset.is_pinned && !asset.is_archived)
  const recentAssets = assets.filter((asset) => !asset.is_archived)

  return (
    <GlassCard className="h-full">
      <GlassCardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <GlassCardTitle className="flex items-center gap-2">
              <Box className="h-5 w-5 text-sky-400" />
              {t("title")}
            </GlassCardTitle>
            <GlassCardDescription className="mt-1">
              {t("subtitle")}
            </GlassCardDescription>
          </div>
          <Button asChild variant="ghost" size="sm" className="text-[var(--primary)]">
            <Link href="/dashboard/assets">
              {t("actions.openManager")}
              <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </GlassCardHeader>
      <GlassCardContent>
        {isLoading ? (
          <div className="space-y-3">
            <div className="h-16 animate-pulse rounded-xl bg-[var(--foreground)]/5" />
            <div className="h-16 animate-pulse rounded-xl bg-[var(--foreground)]/5" />
          </div>
        ) : recentAssets.length > 0 ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-border/60 bg-background/60 p-4">
                <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                  {t("sections.pinned")}
                </div>
                <div className="mt-2 text-2xl font-semibold text-foreground">
                  {pinnedAssets.length}
                </div>
              </div>
              <div className="rounded-xl border border-border/60 bg-background/60 p-4">
                <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                  {t("sections.recent")}
                </div>
                <div className="mt-2 text-2xl font-semibold text-foreground">
                  {recentAssets.length}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              {recentAssets.slice(0, 3).map((asset) => (
                <div
                  key={asset.asset_id}
                  className="flex items-center justify-between rounded-xl border border-border/60 bg-background/60 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">
                      {asset.title}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {asset.summary || t("empty.summary")}
                    </div>
                  </div>
                  <div className="ml-3 flex items-center gap-1 text-muted-foreground">
                    {asset.is_pinned ? <Pin className="h-3.5 w-3.5" /> : null}
                    <Sparkles className="h-3.5 w-3.5" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex h-36 flex-col items-center justify-center gap-2 text-muted-foreground">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-sky-500/10">
              <Box className="h-6 w-6 text-sky-400" />
            </div>
            <div className="text-sm">{t("empty.recent")}</div>
          </div>
        )}
      </GlassCardContent>
    </GlassCard>
  )
}
