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
  Zap,
} from "lucide-react";

import { Button } from "@/components/ui/shadcn/button";
import { Input } from "@/components/ui/shadcn/input";
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/shadcn/radio-group";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/shadcn/sheet";
import { Switch } from "@/components/ui/shadcn/switch";
import { useI18n } from "@/hooks/use-i18n";
import { cn } from "@/lib/utils";

import { lookupLanguageCode } from "./detect-text-language";
import {
  type ClipboardSeedMode,
  type IslandTranslatorAutomationPrefs,
  FAVORITE_TARGETS_STORAGE_KEY,
  RECENT_TARGETS_STORAGE_KEY,
  clearStoredRecentTargets,
  persistFavoriteTargets,
  persistTranslatorAutomation,
  readFavoriteTargets,
  readTranslatorAutomation,
} from "./island-translator-preferences";

export {
  FAVORITE_TARGETS_STORAGE_KEY,
  RECENT_TARGETS_STORAGE_KEY,
  readFavoriteTargets,
};

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

const SEED_MODES: ReadonlyArray<ClipboardSeedMode> = ["ask", "auto", "off"];

export interface IslandTranslateConfigSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fired whenever localStorage is mutated, so the panel can refresh chips. */
  onChange?: () => void;
}

export function IslandTranslateConfigSheet({
  open,
  onOpenChange,
  onChange,
}: IslandTranslateConfigSheetProps) {
  const t = useI18n("island");
  const [favorites, setFavorites] = React.useState<string[]>([]);
  const [draft, setDraft] = React.useState("");
  const [automation, setAutomation] =
    React.useState<IslandTranslatorAutomationPrefs>(() =>
      readTranslatorAutomation(),
    );

  React.useEffect(() => {
    if (!open) return;
    setFavorites(readFavoriteTargets());
    setAutomation(readTranslatorAutomation());
    setDraft("");
  }, [open]);

  const updateAutomation = React.useCallback(
    (patch: Partial<IslandTranslatorAutomationPrefs>) => {
      setAutomation((prev) => {
        const next = { ...prev, ...patch };
        persistTranslatorAutomation(next);
        onChange?.();
        return next;
      });
    },
    [onChange],
  );

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
                {t("selection.configSheet.title")}
              </SheetTitle>
              <SheetDescription className="mt-1 text-xs leading-relaxed">
                {t("selection.configSheet.description")}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          <div className="space-y-5 px-6 py-5">
            {/* Favorites */}
            <Section
              icon={Star}
              title={t("selection.configSheet.favoriteSection")}
              hint={t("selection.configSheet.favoriteHint")}
            >
              {favorites.length === 0 ? (
                <EmptyDeclared
                  label={t("selection.configSheet.noFavorites")}
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
                          title={t("selection.configSheet.moveUp")}
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
                          title={t("selection.configSheet.moveDown")}
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
                  {t("selection.configSheet.addFavorite")}
                </Button>
              </form>

              {suggestionsToShow.length > 0 ? (
                <div className="space-y-1.5 pt-1.5">
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <Sparkles className="h-3 w-3" />
                    <span>
                      {t("selection.configSheet.suggestionsLabel")}
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

            {/* Smart automation */}
            <Section
              icon={Zap}
              title={t("selection.configSheet.automationSection")}
              hint={t("selection.configSheet.automationHint")}
            >
              <div className="flex items-start justify-between gap-3 rounded-md border border-border/60 bg-card px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-foreground">
                    {t(
                      "island.selection.configSheet.autoTranslateOnPaste.title",
                    )}
                  </div>
                  <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                    {t(
                      "island.selection.configSheet.autoTranslateOnPaste.hint",
                    )}
                  </div>
                </div>
                <Switch
                  checked={automation.autoTranslateOnPaste}
                  onCheckedChange={(checked) =>
                    updateAutomation({ autoTranslateOnPaste: checked })
                  }
                  aria-label={t(
                    "island.selection.configSheet.autoTranslateOnPaste.title",
                  )}
                  className="mt-0.5 shrink-0"
                />
              </div>

              <div className="rounded-md border border-border/60 bg-card px-3 py-2.5">
                <div className="text-xs font-medium text-foreground">
                  {t("selection.configSheet.clipboardSeed.title")}
                </div>
                <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                  {t("selection.configSheet.clipboardSeed.hint")}
                </div>
                <RadioGroup
                  value={automation.clipboardSeedMode}
                  onValueChange={(value) =>
                    updateAutomation({
                      clipboardSeedMode: value as ClipboardSeedMode,
                    })
                  }
                  className="mt-2.5 grid gap-1.5"
                >
                  {SEED_MODES.map((mode) => {
                    const id = `clipboard-seed-${mode}`;
                    const isActive = automation.clipboardSeedMode === mode;
                    return (
                      <label
                        key={mode}
                        htmlFor={id}
                        className={cn(
                          "flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 transition-colors",
                          isActive
                            ? "border-primary/50 bg-primary/[0.04]"
                            : "border-border/50 hover:bg-muted/50",
                        )}
                      >
                        <RadioGroupItem
                          value={mode}
                          id={id}
                          className="mt-0.5"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] font-medium text-foreground">
                            {t(
                              `island.selection.configSheet.clipboardSeed.modes.${mode}.label`,
                            )}
                          </div>
                          <div className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
                            {t(
                              `island.selection.configSheet.clipboardSeed.modes.${mode}.hint`,
                            )}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </RadioGroup>
              </div>
            </Section>

            {/* Recent history controls */}
            <Section
              icon={History}
              title={t("selection.configSheet.historySection")}
              hint={t("selection.configSheet.historyHint")}
            >
              <Button
                variant="outline"
                size="sm"
                onClick={handleClearRecent}
                className="w-full"
              >
                <Trash2 className="mr-2 h-3.5 w-3.5" />
                {t("selection.configSheet.clearHistory")}
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
            {t("selection.configSheet.close")}
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

