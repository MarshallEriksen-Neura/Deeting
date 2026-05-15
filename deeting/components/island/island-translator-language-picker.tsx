"use client";

import * as React from "react";
import { Check, ChevronDown, Globe, Sparkles, Star } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/shadcn/popover";
import { useI18n } from "@/hooks/use-i18n";
import { cn } from "@/lib/utils";

const POPULAR_LANGUAGES: ReadonlyArray<string> = [
  "English",
  "Chinese",
  "Japanese",
  "Korean",
  "French",
  "German",
  "Spanish",
  "Russian",
  "Arabic",
];

export type IslandTranslatorLanguagePickerKind = "source" | "target";

export interface IslandTranslatorLanguagePickerProps {
  kind: IslandTranslatorLanguagePickerKind;
  /**
   * Current selection.
   * - For source: undefined === "Auto" (let the model detect).
   * - For target: must be a non-empty display name.
   */
  value: string | undefined;
  /** Selection callback. For source, undefined === "Auto". */
  onChange: (next: string | undefined) => void;
  /** Optional detected source language hint. Only used when kind === "source". */
  detected?: { displayName: string } | null;
  recent?: ReadonlyArray<string>;
  favorites?: ReadonlyArray<string>;
  disabled?: boolean;
  className?: string;
}

export function IslandTranslatorLanguagePicker({
  kind,
  value,
  onChange,
  detected,
  recent = [],
  favorites = [],
  disabled = false,
  className,
}: IslandTranslatorLanguagePickerProps) {
  const t = useI18n("island");
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState("");

  const isSource = kind === "source";
  const autoLabel = t("translator.auto");
  const displayLabel = (() => {
    if (isSource && value === undefined) {
      if (detected?.displayName) {
        return `${autoLabel} · ${detected.displayName}`;
      }
      return autoLabel;
    }
    return value ?? autoLabel;
  })();

  const popularToShow = React.useMemo(() => {
    const taken = new Set<string>([
      ...recent.map((entry) => entry.toLowerCase()),
      ...favorites.map((entry) => entry.toLowerCase()),
    ]);
    if (value) taken.add(value.toLowerCase());
    return POPULAR_LANGUAGES.filter(
      (entry) => !taken.has(entry.toLowerCase()),
    );
  }, [recent, favorites, value]);

  const recentToShow = React.useMemo(() => {
    const lowerFavorites = new Set(
      favorites.map((entry) => entry.toLowerCase()),
    );
    return recent.filter(
      (entry) => !lowerFavorites.has(entry.toLowerCase()),
    );
  }, [recent, favorites]);

  function pick(next: string | undefined) {
    onChange(next);
    setDraft("");
    setOpen(false);
  }

  function handleCustomSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    pick(trimmed);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={
            isSource
              ? t("translator.sourceLanguage")
              : t("translator.targetLanguage")
          }
          className={cn(
            "inline-flex h-8 items-center justify-between gap-1.5 rounded-full border px-3 text-[12px] font-semibold outline-none transition-colors",
            "border-white/38 bg-white/50 text-foreground/76 hover:bg-white/65 dark:border-white/10 dark:bg-white/6",
            disabled && "cursor-not-allowed opacity-55",
            className,
          )}
        >
          <span className="flex-1 truncate text-center">{displayLabel}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="center"
        sideOffset={8}
        className="z-[2147483200] w-[280px] p-3"
      >
        {isSource ? (
          <button
            type="button"
            onClick={() => pick(undefined)}
            className={cn(
              "mb-3 inline-flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-[11px] font-semibold transition-colors",
              value === undefined
                ? "border-island-gold/45 bg-island-gold/12 text-island-gold"
                : "border-foreground/10 hover:bg-foreground/5",
            )}
          >
            {value === undefined ? (
              <Check className="h-3 w-3 shrink-0" />
            ) : (
              <Globe className="h-3 w-3 shrink-0 opacity-60" />
            )}
            <span className="flex-1 truncate">{autoLabel}</span>
            {detected?.displayName ? (
              <span className="rounded-full bg-foreground/8 px-1.5 py-0.5 text-[10px] font-medium text-foreground/55">
                {detected.displayName}
              </span>
            ) : null}
          </button>
        ) : null}

        {favorites.length > 0 ? (
          <div className="mb-3">
            <div className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground/50">
              <Star className="h-3 w-3 text-island-gold/70" />
              <span>{t("translator.favorites")}</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {favorites.map((target) => {
                const isCurrent =
                  value !== undefined &&
                  target.toLowerCase() === value.toLowerCase();
                return (
                  <button
                    key={target}
                    type="button"
                    onClick={() => pick(target)}
                    className={cn(
                      "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-[11px] transition-colors",
                      isCurrent
                        ? "border-island-gold/45 bg-island-gold/14 text-island-gold"
                        : "border-island-gold/25 bg-island-gold/5 text-foreground/75 hover:bg-island-gold/10",
                    )}
                  >
                    {isCurrent ? (
                      <Check className="h-3 w-3" />
                    ) : (
                      <Star className="h-2.5 w-2.5 text-island-gold/65" />
                    )}
                    {target}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {recentToShow.length > 0 ? (
          <div className="mb-3">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground/50">
              {t("translator.recent")}
            </div>
            <div className="flex flex-wrap gap-1">
              {recentToShow.map((target) => {
                const isCurrent =
                  value !== undefined &&
                  target.toLowerCase() === value.toLowerCase();
                return (
                  <button
                    key={target}
                    type="button"
                    onClick={() => pick(target)}
                    className={cn(
                      "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-[11px] transition-colors",
                      isCurrent
                        ? "border-island-gold/40 bg-island-gold/12 text-island-gold"
                        : "border-foreground/15 bg-background hover:bg-foreground/5",
                    )}
                  >
                    {isCurrent ? <Check className="h-3 w-3" /> : null}
                    {target}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {popularToShow.length > 0 ? (
          <div className="mb-3">
            <div className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground/50">
              <Sparkles className="h-3 w-3 text-island-gold/70" />
              <span>{t("translator.popular")}</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {popularToShow.map((displayName) => (
                <button
                  key={displayName}
                  type="button"
                  onClick={() => pick(displayName)}
                  className="inline-flex h-7 items-center rounded-full border border-foreground/15 bg-background px-2.5 text-[11px] transition-colors hover:bg-foreground/5"
                >
                  {displayName}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <form
          onSubmit={handleCustomSubmit}
          className="flex items-center gap-1.5"
        >
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={t("translator.customPlaceholder")}
            className="h-7 flex-1 rounded-full border border-foreground/15 bg-background px-2.5 text-[11px] outline-none placeholder:text-foreground/40 focus:border-island-gold/40"
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            className="inline-flex h-7 items-center justify-center rounded-full bg-island-gold/15 px-2.5 text-[10px] font-semibold text-island-gold transition-colors hover:bg-island-gold/22 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("translator.customApply")}
          </button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

