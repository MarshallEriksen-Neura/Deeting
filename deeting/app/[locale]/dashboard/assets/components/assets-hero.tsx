"use client";

import {
  Box,
  Pin,
  Plus,
  RefreshCw,
  Sparkles,
  Workflow,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LocalAsset } from "@/lib/api/local-assets";
import { cn } from "@/lib/utils";

import { getDataModeLabel, type AssetPageTranslator } from "./assets-utils";

interface AssetsHeroProps {
  activeAssetCount: number;
  loading: boolean;
  onCreate: () => void;
  onOpenSpotlight: () => void;
  onReload: () => void;
  pinnedAssetCount: number;
  previewReadyCount: number;
  selfFetchAssetCount: number;
  spotlightAsset: LocalAsset | null;
  t: AssetPageTranslator;
}

export function AssetsHero({
  activeAssetCount,
  loading,
  onCreate,
  onOpenSpotlight,
  onReload,
  pinnedAssetCount,
  previewReadyCount,
  selfFetchAssetCount,
  spotlightAsset,
  t,
}: AssetsHeroProps) {
  const statCards: Array<{
    accent: string;
    hint: string;
    icon: LucideIcon;
    label: string;
    value: number;
  }> = [
    {
      label: t("stats.total.label"),
      hint: t("stats.total.hint"),
      value: activeAssetCount,
      icon: Box,
      accent: "from-sky-500/25 via-cyan-400/10 to-transparent",
    },
    {
      label: t("stats.pinned.label"),
      hint: t("stats.pinned.hint"),
      value: pinnedAssetCount,
      icon: Pin,
      accent: "from-amber-400/25 via-orange-300/10 to-transparent",
    },
    {
      label: t("stats.selfFetch.label"),
      hint: t("stats.selfFetch.hint"),
      value: selfFetchAssetCount,
      icon: Workflow,
      accent: "from-emerald-500/20 via-teal-400/10 to-transparent",
    },
    {
      label: t("stats.snapshot.label"),
      hint: t("stats.snapshot.hint"),
      value: previewReadyCount,
      icon: Sparkles,
      accent: "from-indigo-400/25 via-sky-300/10 to-transparent",
    },
  ];

  return (
    <section className="relative overflow-hidden rounded-[32px] border border-sky-200/70 bg-white/80 shadow-[0_28px_80px_-44px_rgba(15,23,42,0.4)] backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.06]">
      <div className="pointer-events-none absolute -left-20 top-0 h-52 w-52 rounded-full bg-sky-400/20 blur-3xl dark:bg-sky-400/10" />
      <div className="pointer-events-none absolute right-0 top-10 h-48 w-48 rounded-full bg-emerald-400/15 blur-3xl dark:bg-emerald-300/10" />

      <div className="relative grid gap-6 p-6 lg:p-8 xl:grid-cols-[minmax(0,1.2fr)_360px]">
        <div className="space-y-6">
          <div className="space-y-4">
            <Badge
              variant="outline"
              className="border-sky-300/60 bg-white/60 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-sky-700 dark:border-sky-300/20 dark:bg-white/[0.03] dark:text-sky-200"
            >
              {t("hero.eyebrow")}
            </Badge>

            <div className="max-w-3xl space-y-3">
              <h1 className="text-4xl font-semibold tracking-[-0.03em] text-slate-950 dark:text-white">
                {t("title")}
              </h1>
              <p className="max-w-2xl text-sm leading-7 text-slate-600 dark:text-slate-300">
                {t("subtitle")}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                size="lg"
                className="rounded-full bg-slate-950 px-5 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
                onClick={onCreate}
              >
                <Plus className="size-4" />
                {t("actions.create")}
              </Button>
              <Button
                type="button"
                size="lg"
                variant="outline"
                className="rounded-full border-sky-200 bg-white/70 px-5 dark:border-white/10 dark:bg-white/[0.04]"
                onClick={onReload}
              >
                <RefreshCw
                  className={cn("size-4", loading && "animate-spin")}
                />
                {t("actions.reload")}
              </Button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {statCards.map((card) => (
              <div
                key={card.label}
                className="relative overflow-hidden rounded-[26px] border border-slate-200/70 bg-white/75 p-5 shadow-[0_18px_45px_-34px_rgba(15,23,42,0.5)] dark:border-white/10 dark:bg-white/[0.04]"
              >
                <div
                  className={cn(
                    "pointer-events-none absolute inset-0 bg-gradient-to-br",
                    card.accent,
                  )}
                />
                <div className="relative flex items-start justify-between gap-4">
                  <div className="space-y-2">
                    <div className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                      {card.label}
                    </div>
                    <div className="text-3xl font-semibold tracking-[-0.03em] text-slate-950 dark:text-white">
                      {card.value}
                    </div>
                    <p className="max-w-[220px] text-xs leading-6 text-slate-600 dark:text-slate-400">
                      {card.hint}
                    </p>
                  </div>
                  <div className="flex size-11 items-center justify-center rounded-2xl border border-white/60 bg-white/65 text-slate-900 shadow-sm dark:border-white/10 dark:bg-white/[0.06] dark:text-white">
                    <card.icon className="size-5" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="overflow-hidden rounded-[28px] border border-slate-900/5 bg-slate-950 text-white shadow-[0_32px_90px_-40px_rgba(2,6,23,0.9)]">
          <div className="flex h-full flex-col p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2">
                <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">
                  {t("sections.spotlight")}
                </div>
                <div className="text-xl font-semibold tracking-[-0.02em] text-white">
                  {spotlightAsset?.title || t("empty.spotlight")}
                </div>
              </div>
              {spotlightAsset ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="rounded-full bg-white/10 text-white hover:bg-white/15 hover:text-white"
                  onClick={onOpenSpotlight}
                >
                  {t("actions.openDetails")}
                </Button>
              ) : null}
            </div>

            <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-300">
              {spotlightAsset?.summary || t("empty.summary")}
            </p>

            <div className="mt-5 overflow-hidden rounded-[24px] border border-white/10 bg-white/5">
              {spotlightAsset?.latest_snapshot_html ? (
                <iframe
                  title={spotlightAsset.title}
                  srcDoc={spotlightAsset.latest_snapshot_html}
                  sandbox=""
                  className="h-56 w-full bg-white"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-56 items-center justify-center px-6 text-center text-sm text-slate-400">
                  {t("empty.snapshot")}
                </div>
              )}
            </div>

            {spotlightAsset ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {spotlightAsset.is_pinned ? (
                  <Badge className="bg-white/12 text-white">
                    {t("filters.pinned")}
                  </Badge>
                ) : null}
                <Badge
                  variant="outline"
                  className="border-white/15 text-slate-200"
                >
                  {getDataModeLabel(spotlightAsset.data_mode, t)}
                </Badge>
                {spotlightAsset.render_hint ? (
                  <Badge
                    variant="outline"
                    className="border-white/15 text-slate-200"
                  >
                    {spotlightAsset.render_hint}
                  </Badge>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
