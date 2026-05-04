"use client";

import * as React from "react";
import {
  History,
  Languages,
  Plus,
  Settings2,
  Sparkles,
  Star,
  Trash2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/shadcn/button";
import { Input } from "@/components/ui/shadcn/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/shadcn/sheet";
import { useI18n } from "@/hooks/use-i18n";
import { cn } from "@/lib/utils";

import { lookupLanguageCode } from "./detect-text-language";

export const FAVORITE_TARGETS_STORAGE_KEY = "island-selection-favorite-targets";
export const RECENT_TARGETS_STORAGE_KEY = "island-selection-recent-targets";

const SUGGESTED_LANGUAGES = [
  "English",
  "Chinese",
  "Japanese",
  "Korean",
  "French",
  "German",
  "Spanish",
  "Russian",
  "Arabic",
  "Portuguese",
  "Italian",
] as const;

export interface IslandTranslateConfigSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fired whenever localStorage is mutated, so the panel can refresh chips. */
  onChange?: () => void;
}

export function readFavoriteTargets(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(FAVORITE_TARGETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (entry): entry is string =>
          typeof entry === "string" && entry.trim().length > 0,
      );
    }
  } catch {
    /* swallow malformed storage */
  }
  return [];
}

function persistFavoriteTargets(targets: ReadonlyArray<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      FAVORITE_TARGETS_STORAGE_KEY,
      JSON.stringify(targets),
    );
  } catch {
    /* swallow quota errors */
  }
}

function clearStoredRecentTargets() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(RECENT_TARGETS_STORAGE_KEY);
  } catch {
    /* swallow */
  }
}

export function IslandTranslateConfigSheet({
  open,
  onOpenChange,
  onChange,
}: IslandTranslateConfigSheetProps) {
  const t = useI18n("chat");
  const [favorites, setFavorites] = React.useState<string[]>([]);
  const [draft, setDraft] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    setFavorites(readFavoriteTargets());
    setDraft("");
  }, [open]);

  const commit = React.useCallback(
    (next: string[]) => {
      setFavorites(next);
      persistFavoriteTargets(next);
      onChange?.();
    },
    [onChange],
  );

  const handleAdd = React.useCallback(
    (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) return;
      // Canonicalize: if the input matches a known language code, store the canonical name.
      const code = lookupLanguageCode(trimmed);
      const canonical = code ? canonicalDisplayName(trimmed) : trimmed;
      if (
        favorites.some(
          (entry) => entry.toLowerCase() === canonical.toLowerCase(),
        )
      ) {
        return;
      }
      commit([...favorites, canonical]);
    },
    [favorites, commit],
  );

  const handleRemove = React.useCallback(
    (target: string) => {
      commit(favorites.filter((entry) => entry !== target));
    },
    [favorites, commit],
  );

  const handleMove = React.useCallback(
    (index: number, direction: -1 | 1) => {
      const target = index + direction;
      if (target < 0 || target >= favorites.length) return;
      const next = [...favorites];
      [next[index], next[target]] = [next[target], next[index]];
      commit(next);
    },
    [favorites, commit],
  );

  const handleSubmit = React.useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      handleAdd(draft);
      setDraft("");
    },
    [draft, handleAdd],
  );

  const handleClearRecent = React.useCallback(() => {
    clearStoredRecentTargets();
    onChange?.();
  }, [onChange]);

  const suggestionsToShow = React.useMemo(() => {
    const lowerFavorites = new Set(
      favorites.map((entry) => entry.toLowerCase()),
    );
    return SUGGESTED_LANGUAGES.filter(
      (entry) => !lowerFavorites.has(entry.toLowerCase()),
    );
  }, [favorites]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
      >
        <SheetHeader className="relative gap-0 border-b bg-gradient-to-br from-primary/[0.06] via-background to-background px-6 pb-5 pt-6">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
              <Settings2 className="h-[18px] w-[18px]" />
            </div>
            <div className="min-w-0 flex-1 pr-6">
              <SheetTitle className="truncate text-[15px] font-semibold leading-tight">
                {t("island.selection.configSheet.title")}
              </SheetTitle>
              <SheetDescription className="mt-1 text-xs leading-relaxed">
                {t("island.selection.configSheet.description")}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          <div className="space-y-5 px-6 py-5">
            {/* Favorites */}
            <Section
              icon={Star}
              title={t("island.selection.configSheet.favoriteSection")}
              hint={t("island.selection.configSheet.favoriteHint")}
            >
              {favorites.length === 0 ? (
                <EmptyDeclared
                  label={t("island.selection.configSheet.noFavorites")}
                />
              ) : (
                <ul className="space-y-1.5">
                  {favorites.map((target, index) => (
                    <li
                      key={target}
                      className="flex items-center gap-2 rounded-md border border-border/60 bg-card px-3 py-2 text-xs"
                    >
                      <Languages className="h-3.5 w-3.5 shrink-0 text-primary/70" />
                      <span className="truncate font-medium text-foreground">
                        {target}
                      </span>
                      <div className="ml-auto flex items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => handleMove(index, -1)}
                          disabled={index === 0}
                          aria-label={t(
                            "island.selection.configSheet.moveUp",
                          )}
                          title={t("island.selection.configSheet.moveUp")}
                          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted disabled:opacity-30"
                        >
                          <span aria-hidden="true">↑</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMove(index, 1)}
                          disabled={index === favorites.length - 1}
                          aria-label={t(
                            "island.selection.configSheet.moveDown",
                          )}
                          title={t("island.selection.configSheet.moveDown")}
                          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted disabled:opacity-30"
                        >
                          <span aria-hidden="true">↓</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemove(target)}
                          aria-label={t(
                            "island.selection.configSheet.removeFavorite",
                            { target },
                          )}
                          title={t(
                            "island.selection.configSheet.removeFavorite",
                            { target },
                          )}
                          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <form
                onSubmit={handleSubmit}
                className="flex items-center gap-1.5 pt-1"
              >
                <Input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={t(
                    "island.selection.configSheet.addFavoritePlaceholder",
                  )}
                  className="h-8 text-xs"
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={!draft.trim()}
                  className="shrink-0"
                >
                  <Plus className="mr-1 h-3 w-3" />
                  {t("island.selection.configSheet.addFavorite")}
                </Button>
              </form>

              {suggestionsToShow.length > 0 ? (
                <div className="space-y-1.5 pt-1.5">
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <Sparkles className="h-3 w-3" />
                    <span>
                      {t("island.selection.configSheet.suggestionsLabel")}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {suggestionsToShow.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => handleAdd(suggestion)}
                        className={cn(
                          "inline-flex h-6 items-center gap-1 rounded-full border border-dashed border-border/70 bg-background px-2 text-[11px] text-muted-foreground transition-colors",
                          "hover:border-primary/40 hover:bg-primary/5 hover:text-primary",
                        )}
                      >
                        <Plus className="h-2.5 w-2.5" />
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </Section>

            {/* Recent history controls */}
            <Section
              icon={History}
              title={t("island.selection.configSheet.historySection")}
              hint={t("island.selection.configSheet.historyHint")}
            >
              <Button
                variant="outline"
                size="sm"
                onClick={handleClearRecent}
                className="w-full"
              >
                <Trash2 className="mr-2 h-3.5 w-3.5" />
                {t("island.selection.configSheet.clearHistory")}
              </Button>
            </Section>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t bg-background/95 px-6 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            {t("island.selection.configSheet.close")}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Section({
  icon: Icon,
  title,
  hint,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2.5">
      <div>
        <div className="flex items-center gap-2">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {title}
          </h3>
        </div>
        {hint ? (
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground/85">
            {hint}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function EmptyDeclared({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
      {label}
    </div>
  );
}

const CANONICAL_NAMES: Record<string, string> = {
  zh: "Chinese",
  en: "English",
  ja: "Japanese",
  ko: "Korean",
  ar: "Arabic",
  ru: "Russian",
  fr: "French",
  de: "German",
  es: "Spanish",
  pt: "Portuguese",
  it: "Italian",
};

/** Match input against display-name table, case-insensitively. */
function canonicalDisplayName(raw: string): string {
  const code = lookupLanguageCode(raw);
  if (code && CANONICAL_NAMES[code]) return CANONICAL_NAMES[code];
  return raw.trim();
}
