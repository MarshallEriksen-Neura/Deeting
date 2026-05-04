"use client";

import { useCallback, useMemo, useState } from "react";
import {
  BookOpenText,
  Check,
  ChevronDown,
  Copy,
  Languages,
  ListChecks,
  Search,
  Settings2,
  Sparkles,
  Star,
  X,
} from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/shadcn/popover";
import { useI18n } from "@/hooks/use-i18n";
import { cn } from "@/lib/utils";

import {
  type DetectedLanguageCode,
  languageDisplayName,
  languageShortLabel,
  lookupLanguageCode,
  resolveSmartTarget,
} from "./detect-text-language";
import {
  IslandTranslateConfigSheet,
  readFavoriteTargets,
} from "./island-translate-config-sheet";
import type {
  IslandSelectionActionKind,
  IslandSelectionContext,
} from "./selection-context-types";
import type { SelectionActionPromptOptions } from "./selection-action-prompts";

const RECENT_TARGETS_STORAGE_KEY = "island-selection-recent-targets";
const MAX_RECENT_TARGETS = 3;

const POPULAR_LANGUAGES: ReadonlyArray<{
  code: Exclude<DetectedLanguageCode, "unknown">;
  displayName: string;
}> = [
  { code: "en", displayName: "English" },
  { code: "zh", displayName: "Chinese" },
  { code: "ja", displayName: "Japanese" },
  { code: "ko", displayName: "Korean" },
  { code: "fr", displayName: "French" },
  { code: "de", displayName: "German" },
  { code: "es", displayName: "Spanish" },
  { code: "ru", displayName: "Russian" },
  { code: "ar", displayName: "Arabic" },
];

const SECONDARY_ACTIONS: Array<{
  kind: Exclude<IslandSelectionActionKind, "translate">;
  icon: typeof Languages;
  labelKey: string;
}> = [
  { kind: "explain", icon: BookOpenText, labelKey: "explain" },
  { kind: "summarize", icon: ListChecks, labelKey: "summarize" },
  { kind: "ask", icon: Sparkles, labelKey: "ask" },
  { kind: "search", icon: Search, labelKey: "search" },
  { kind: "copy", icon: Copy, labelKey: "copy" },
];

function isZhUiLocale() {
  if (typeof navigator !== "undefined" && navigator.language?.startsWith("zh")) {
    return true;
  }
  if (
    typeof document !== "undefined" &&
    document.documentElement.lang?.startsWith("zh")
  ) {
    return true;
  }
  return false;
}

function resolveUiTargetDisplayName() {
  return isZhUiLocale() ? "Chinese" : "English";
}

function readStoredRecentTargets(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_TARGETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed
        .filter(
          (entry): entry is string =>
            typeof entry === "string" && entry.trim().length > 0,
        )
        .slice(0, MAX_RECENT_TARGETS);
    }
  } catch {
    /* swallow malformed storage */
  }
  return [];
}

function persistRecentTargets(targets: ReadonlyArray<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      RECENT_TARGETS_STORAGE_KEY,
      JSON.stringify(targets.slice(0, MAX_RECENT_TARGETS)),
    );
  } catch {
    /* swallow quota errors */
  }
}

function pushRecentTarget(
  current: ReadonlyArray<string>,
  target: string,
): string[] {
  const trimmed = target.trim();
  if (!trimmed) return [...current];
  const filtered = current.filter(
    (entry) => entry.toLowerCase() !== trimmed.toLowerCase(),
  );
  return [trimmed, ...filtered].slice(0, MAX_RECENT_TARGETS);
}

function shortLabelForTarget(target: string, uiLocale: "zh" | "en"): string {
  const code = lookupLanguageCode(target);
  if (code) return languageShortLabel(code, uiLocale);
  // Custom target — fall back to the first 2 chars (after upcasing first).
  const trimmed = target.trim();
  if (!trimmed) return "?";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1, 2).toLowerCase();
}

export function IslandSelectionPanel({
  selection,
  isBusy,
  onRunAction,
  onDismiss,
}: {
  selection: IslandSelectionContext;
  isBusy: boolean;
  onRunAction: (
    kind: IslandSelectionActionKind,
    options?: SelectionActionPromptOptions,
  ) => void;
  onDismiss: (selectionId: string) => void;
}) {
  const t = useI18n("chat");
  const isZh = useMemo(() => isZhUiLocale(), []);
  const uiTarget = useMemo(() => resolveUiTargetDisplayName(), []);
  const [recentTargets, setRecentTargets] = useState<string[]>(() =>
    readStoredRecentTargets(),
  );
  const [favoriteTargets, setFavoriteTargets] = useState<string[]>(() =>
    readFavoriteTargets(),
  );
  const [customTargetDraft, setCustomTargetDraft] = useState("");
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [configSheetOpen, setConfigSheetOpen] = useState(false);

  const refreshFromStorage = useCallback(() => {
    setFavoriteTargets(readFavoriteTargets());
    setRecentTargets(readStoredRecentTargets());
  }, []);

  const detected = selection.detectedLanguage;
  const detectedCode = detected.code;

  const smartTarget = useMemo(
    () => resolveSmartTarget(detectedCode, uiTarget, recentTargets),
    [detectedCode, uiTarget, recentTargets],
  );

  const sourceShort = languageShortLabel(detectedCode, isZh ? "zh" : "en");
  const targetShort = shortLabelForTarget(smartTarget, isZh ? "zh" : "en");

  const popularToShow = useMemo(() => {
    const taken = new Set([
      ...recentTargets.map((entry) => entry.toLowerCase()),
      ...favoriteTargets.map((entry) => entry.toLowerCase()),
    ]);
    return POPULAR_LANGUAGES.filter(
      (language) => !taken.has(language.displayName.toLowerCase()),
    );
  }, [recentTargets, favoriteTargets]);

  const recentToShow = useMemo(() => {
    const lowerFavorites = new Set(
      favoriteTargets.map((entry) => entry.toLowerCase()),
    );
    return recentTargets.filter(
      (entry) => !lowerFavorites.has(entry.toLowerCase()),
    );
  }, [recentTargets, favoriteTargets]);

  const hasSelection = selection.text.trim().length > 0;
  const activeAction = selection.activeAction;
  const isTranslateActive = activeAction === "translate";

  function commitTranslate(target: string) {
    const trimmed = target.trim();
    if (!trimmed) return;
    const next = pushRecentTarget(recentTargets, trimmed);
    setRecentTargets(next);
    persistRecentTargets(next);
    onRunAction("translate", {
      translateSource:
        detectedCode !== "unknown"
          ? languageDisplayName(detectedCode)
          : undefined,
      translateTarget: trimmed,
    });
  }

  function handlePickFromPopover(target: string) {
    commitTranslate(target);
    setCustomTargetDraft("");
    setPopoverOpen(false);
  }

  function handleSubmitCustomTarget(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = customTargetDraft.trim();
    if (!trimmed) return;
    handlePickFromPopover(trimmed);
  }

  return (
    <>
      <div className="relative overflow-hidden rounded-[24px] border border-white/35 bg-[linear-gradient(180deg,rgba(255,255,255,0.58),rgba(247,242,235,0.32))] px-3 py-3 shadow-[0_16px_36px_-32px_rgba(0,0,0,0.32)] dark:border-white/8 dark:bg-[linear-gradient(180deg,rgba(48,40,31,0.55),rgba(24,22,20,0.42))]">
      <div className="pointer-events-none absolute inset-x-7 top-0 h-px bg-white/60 dark:bg-white/12" />
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-island-gold/22 bg-island-gold/9 text-island-gold shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]">
          <Sparkles className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <div className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/40">
              {t("island.selection.title")}
            </div>
            <div className="h-px min-w-4 flex-1 bg-foreground/8" />
            <div className="shrink-0 text-[10px] text-foreground/42">
              {t(`island.selection.sources.${selection.source}`)} ·{" "}
              {t("island.selection.charCount", {
                count: selection.charCount,
              })}
              {selection.truncated
                ? ` · ${t("island.selection.truncated")}`
                : ""}
            </div>
          </div>

          {hasSelection ? (
            <p className="mt-1.5 max-h-[74px] overflow-y-auto whitespace-pre-wrap break-words pr-1 text-[13px] leading-6 text-foreground/76 island-content-scrollbar">
              {selection.preview}
            </p>
          ) : (
            <div className="mt-1.5 rounded-[18px] border border-amber-300/30 bg-amber-50/65 px-3 py-2 text-[12px] leading-5 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/25 dark:text-amber-200">
              {t("island.selection.empty")}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => onDismiss(selection.selectionId)}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-foreground/42 transition-colors hover:bg-white/50 hover:text-foreground/65 dark:hover:bg-white/8"
          aria-label={t("island.selection.dismiss")}
          title={t("island.selection.dismiss")}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {hasSelection ? (
        <div className="mt-3 flex items-center gap-1.5 overflow-x-auto pb-0.5 island-content-scrollbar">
          {/* Translate split-button: one-click to smart target, dropdown for picker */}
          <div
            className={cn(
              "inline-flex h-8 shrink-0 items-stretch overflow-hidden rounded-full border transition-colors",
              isTranslateActive
                ? "border-island-gold/35 bg-island-gold/13 text-island-gold shadow-[0_8px_18px_-15px_rgba(0,0,0,0.28)]"
                : "border-white/38 bg-white/36 text-foreground/70 hover:bg-white/58 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/9",
              isBusy && "cursor-not-allowed opacity-55",
            )}
          >
            <button
              type="button"
              disabled={isBusy}
              onClick={() => commitTranslate(smartTarget)}
              className="inline-flex items-center gap-1.5 pl-3 pr-2 text-[11px] font-semibold focus:outline-none disabled:cursor-not-allowed"
              title={t("island.selection.translateTo", { target: smartTarget })}
              aria-label={t("island.selection.translateTo", {
                target: smartTarget,
              })}
            >
              <Languages className="h-3.5 w-3.5 shrink-0" />
              <span>{t("island.selection.actions.translate")}</span>
              <span
                className={cn(
                  "ml-0.5 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium tracking-tight",
                  isTranslateActive
                    ? "bg-island-gold/12 text-island-gold/85"
                    : "bg-foreground/8 text-foreground/55",
                )}
                aria-hidden="true"
              >
                <span>{sourceShort}</span>
                <span className="opacity-50">→</span>
                <span>{targetShort}</span>
              </span>
            </button>
            <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  disabled={isBusy}
                  className={cn(
                    "flex items-center justify-center border-l px-2 transition-colors disabled:cursor-not-allowed",
                    isTranslateActive
                      ? "border-island-gold/30 hover:bg-island-gold/8"
                      : "border-white/30 hover:bg-white/35 dark:border-white/8 dark:hover:bg-white/6",
                  )}
                  aria-label={t("island.selection.translateOptions")}
                  title={t("island.selection.translateOptions")}
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                sideOffset={8}
                className="w-[320px] p-3"
              >
                {favoriteTargets.length > 0 ? (
                  <div className="mb-3">
                    <div className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground/50">
                      <Star className="h-3 w-3 text-island-gold/70" />
                      <span>{t("island.selection.translateFavorites")}</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {favoriteTargets.map((target) => {
                        const isCurrent =
                          target.toLowerCase() === smartTarget.toLowerCase();
                        return (
                          <button
                            key={target}
                            type="button"
                            disabled={isBusy}
                            onClick={() => handlePickFromPopover(target)}
                            className={cn(
                              "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-50",
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
                      {t("island.selection.translateRecent")}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {recentToShow.map((target) => {
                        const isCurrent =
                          target.toLowerCase() === smartTarget.toLowerCase();
                        return (
                          <button
                            key={target}
                            type="button"
                            disabled={isBusy}
                            onClick={() => handlePickFromPopover(target)}
                            className={cn(
                              "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-50",
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
                    <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground/50">
                      {t("island.selection.translatePopular")}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {popularToShow.map(({ displayName }) => (
                        <button
                          key={displayName}
                          type="button"
                          disabled={isBusy}
                          onClick={() => handlePickFromPopover(displayName)}
                          className="inline-flex h-7 items-center rounded-full border border-foreground/15 bg-background px-2.5 text-[11px] transition-colors hover:bg-foreground/5 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {displayName}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                <form
                  onSubmit={handleSubmitCustomTarget}
                  className="flex items-center gap-1.5"
                >
                  <input
                    value={customTargetDraft}
                    onChange={(event) =>
                      setCustomTargetDraft(event.target.value)
                    }
                    placeholder={t("island.selection.customTarget")}
                    className="h-7 flex-1 rounded-full border border-foreground/15 bg-background px-2.5 text-[11px] outline-none placeholder:text-foreground/40 focus:border-island-gold/40"
                  />
                  <button
                    type="submit"
                    disabled={isBusy || !customTargetDraft.trim()}
                    className="inline-flex h-7 items-center justify-center rounded-full bg-island-gold/15 px-2.5 text-[10px] font-semibold text-island-gold transition-colors hover:bg-island-gold/22 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {t("island.selection.translateApply")}
                  </button>
                </form>

                <div className="mt-3 flex items-center justify-between border-t border-foreground/10 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setPopoverOpen(false);
                      setConfigSheetOpen(true);
                    }}
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-medium text-foreground/55 transition-colors hover:bg-foreground/5 hover:text-foreground/85"
                  >
                    <Settings2 className="h-3 w-3" />
                    {t("island.selection.translateManage")}
                  </button>
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {SECONDARY_ACTIONS.map((action) => {
            const Icon = action.icon;
            const isActive = activeAction === action.kind;
            return (
              <button
                key={action.kind}
                type="button"
                disabled={isBusy}
                onClick={() => {
                  if (action.kind === "ask") {
                    onRunAction("ask");
                    return;
                  }
                  onRunAction(action.kind);
                }}
                className={cn(
                  "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full border px-3 text-[11px] font-semibold transition-colors",
                  isActive
                    ? "border-island-gold/35 bg-island-gold/13 text-island-gold shadow-[0_8px_18px_-15px_rgba(0,0,0,0.28)]"
                    : "border-white/38 bg-white/36 text-foreground/58 hover:bg-white/58 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/9",
                  isBusy && "cursor-not-allowed opacity-55",
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">
                  {t(`island.selection.actions.${action.labelKey}`)}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
      <IslandTranslateConfigSheet
        open={configSheetOpen}
        onOpenChange={setConfigSheetOpen}
        onChange={refreshFromStorage}
      />
    </>
  );
}
