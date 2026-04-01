"use client";

import Link from "next/link";
import { Archive, Clock3, ExternalLink, Pin, PinOff } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LocalAsset } from "@/lib/api/local-assets";
import { cn } from "@/lib/utils";

import {
  getAssetActivityLabel,
  getDataModeLabel,
  parseStringList,
  type AssetPageTranslator,
} from "./assets-utils";

interface AssetLibraryCardProps {
  asset: LocalAsset;
  busyAssetId: string | null;
  locale: string;
  onArchive: () => void;
  onOpenConversation: string | null;
  onOpenDetails: () => void;
  onTogglePin: () => void;
  t: AssetPageTranslator;
}

export function AssetLibraryCard({
  asset,
  busyAssetId,
  locale,
  onArchive,
  onOpenConversation,
  onOpenDetails,
  onTogglePin,
  t,
}: AssetLibraryCardProps) {
  const matchHints = parseStringList(asset.match_hints_json);
  const activityLabel = getAssetActivityLabel(asset, locale, t);
  const sourceLabel = asset.origin_session_id
    ? t("fields.sourceSession", { value: asset.origin_session_id })
    : t("fields.createdLocally");

  return (
    <article
      className={cn(
        "group relative overflow-hidden rounded-[28px] border bg-white/85 p-5 shadow-[0_22px_50px_-38px_rgba(15,23,42,0.5)] transition-transform duration-300 hover:-translate-y-0.5 dark:bg-white/[0.04]",
        asset.is_pinned
          ? "border-amber-200/80 dark:border-amber-300/20"
          : "border-slate-200/70 dark:border-white/10",
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute inset-0 bg-gradient-to-br opacity-90",
          asset.is_pinned
            ? "from-amber-100/70 via-white/20 to-transparent dark:from-amber-300/10"
            : "from-sky-100/70 via-white/15 to-transparent dark:from-sky-400/10",
        )}
      />

      <div className="relative flex h-full flex-col">
        <div className="flex items-start justify-between gap-3">
          <button
            type="button"
            className="min-w-0 flex-1 text-left"
            onClick={onOpenDetails}
          >
            <div className="flex flex-wrap items-center gap-2">
              {asset.is_pinned ? (
                <Badge className="bg-amber-500 text-white">
                  {t("filters.pinned")}
                </Badge>
              ) : null}
              <Badge
                variant="outline"
                className="border-slate-200 bg-white/75 text-slate-700 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300"
              >
                {getDataModeLabel(asset.data_mode, t)}
              </Badge>
            </div>

            <div className="mt-4 line-clamp-2 text-lg font-semibold tracking-[-0.02em] text-slate-950 dark:text-white">
              {asset.title}
            </div>
            <p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-600 dark:text-slate-400">
              {asset.summary || t("empty.summary")}
            </p>
          </button>

          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="rounded-full"
              disabled={busyAssetId === asset.asset_id}
              onClick={(event) => {
                event.stopPropagation();
                onTogglePin();
              }}
              aria-label={
                asset.is_pinned ? t("actions.unpin") : t("actions.pin")
              }
            >
              {asset.is_pinned ? (
                <PinOff className="size-4" />
              ) : (
                <Pin className="size-4" />
              )}
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="rounded-full"
              disabled={busyAssetId === asset.asset_id}
              onClick={(event) => {
                event.stopPropagation();
                onArchive();
              }}
              aria-label={t("actions.archive")}
            >
              <Archive className="size-4" />
            </Button>

            {onOpenConversation ? (
              <Button
                asChild
                type="button"
                variant="ghost"
                size="icon-sm"
                className="rounded-full"
              >
                <Link
                  href={onOpenConversation}
                  aria-label={t("actions.openConversation")}
                  onClick={(event) => event.stopPropagation()}
                >
                  <ExternalLink className="size-4" />
                </Link>
              </Button>
            ) : null}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {asset.render_hint ? (
            <Badge
              variant="outline"
              className="border-slate-200 bg-white/75 text-slate-700 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300"
            >
              {asset.render_hint}
            </Badge>
          ) : null}
          {matchHints.slice(0, 2).map((hint) => (
            <Badge
              key={hint}
              variant="outline"
              className="border-slate-200 bg-white/75 text-slate-700 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300"
            >
              {hint}
            </Badge>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-500 dark:text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <Clock3 className="size-3.5" />
            {activityLabel}
          </span>
          <span className="truncate">{sourceLabel}</span>
          <span>{asset.render_hint || asset.source_view_type}</span>
        </div>
      </div>
    </article>
  );
}
