"use client";

import { useMemo, useState } from "react";
import {
  BookOpenText,
  Check,
  Copy,
  Languages,
  ListChecks,
  MessageSquareText,
  Search,
  Sparkles,
  X,
} from "lucide-react";

import { useI18n } from "@/hooks/use-i18n";
import { cn } from "@/lib/utils";

import type {
  IslandSelectionActionKind,
  IslandSelectionContext,
} from "./selection-context-types";
import type { SelectionActionPromptOptions } from "./selection-action-prompts";

type TranslationPreset = {
  id: string;
  label: string;
  source?: string;
  target: string;
};

const TRANSLATION_TARGET_STORAGE_KEY = "island-selection-translation-target";

const ACTIONS: Array<{
  kind: IslandSelectionActionKind;
  icon: typeof Languages;
  labelKey: string;
}> = [
  { kind: "translate", icon: Languages, labelKey: "translate" },
  { kind: "explain", icon: BookOpenText, labelKey: "explain" },
  { kind: "summarize", icon: ListChecks, labelKey: "summarize" },
  { kind: "ask", icon: Sparkles, labelKey: "ask" },
  { kind: "search", icon: Search, labelKey: "search" },
  { kind: "copy", icon: Copy, labelKey: "copy" },
];

function resolveUiLanguageTarget() {
  if (typeof navigator !== "undefined" && navigator.language.startsWith("zh")) {
    return "Chinese";
  }
  if (
    typeof document !== "undefined" &&
    document.documentElement.lang.startsWith("zh")
  ) {
    return "Chinese";
  }
  return "English";
}

function readStoredTarget(defaultTarget: string) {
  if (typeof window === "undefined") return defaultTarget;
  return (
    window.localStorage.getItem(TRANSLATION_TARGET_STORAGE_KEY) || defaultTarget
  );
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
  const uiTarget = useMemo(() => resolveUiLanguageTarget(), []);
  const [selectedTarget, setSelectedTarget] = useState(() =>
    readStoredTarget(uiTarget),
  );
  const [customTarget, setCustomTarget] = useState("");
  const [askQuestion, setAskQuestion] = useState("");
  const hasSelection = selection.text.trim().length > 0;
  const activeAction = selection.activeAction;

  const translationPresets: TranslationPreset[] = [
    {
      id: "auto-ui",
      label: `Auto -> ${uiTarget}`,
      target: uiTarget,
    },
    {
      id: "en-zh",
      label: "English -> Chinese",
      source: "English",
      target: "Chinese",
    },
    {
      id: "zh-en",
      label: "Chinese -> English",
      source: "Chinese",
      target: "English",
    },
  ];

  const activeTarget = customTarget.trim() || selectedTarget;

  function persistTarget(target: string) {
    setSelectedTarget(target);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(TRANSLATION_TARGET_STORAGE_KEY, target);
    }
  }

  function runTranslate(preset?: TranslationPreset) {
    const target = preset?.target ?? activeTarget;
    persistTarget(target);
    onRunAction("translate", {
      translateSource: preset?.source,
      translateTarget: target,
    });
  }

  return (
    <div className="rounded-[26px] border border-white/40 bg-white/42 p-3 shadow-[0_18px_42px_-34px_rgba(0,0,0,0.35)] dark:border-white/8 dark:bg-white/4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/44">
            {t("island.selection.title")}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-foreground/48">
            <span>{t(`island.selection.sources.${selection.source}`)}</span>
            <span>·</span>
            <span>
              {t("island.selection.charCount", {
                count: selection.charCount,
              })}
            </span>
            {selection.truncated ? (
              <>
                <span>·</span>
                <span className="text-amber-600 dark:text-amber-300">
                  {t("island.selection.truncated")}
                </span>
              </>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onDismiss(selection.selectionId)}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/40 bg-white/45 text-foreground/48 transition-colors hover:bg-white/70 dark:border-white/10 dark:bg-white/6 dark:hover:bg-white/10"
          aria-label={t("island.selection.dismiss")}
          title={t("island.selection.dismiss")}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {hasSelection ? (
        <>
          <div className="rounded-[20px] border border-white/35 bg-white/55 px-3 py-3 dark:border-white/8 dark:bg-white/5">
            <p className="max-h-24 overflow-y-auto whitespace-pre-wrap break-words text-[12px] leading-5 text-foreground/72 island-content-scrollbar">
              {selection.preview}
            </p>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            {ACTIONS.map((action) => {
              const Icon = action.icon;
              const isActive = activeAction === action.kind;
              return (
                <button
                  key={action.kind}
                  type="button"
                  disabled={isBusy}
                  onClick={() => {
                    if (action.kind === "translate") {
                      runTranslate();
                      return;
                    }
                    if (action.kind === "ask") {
                      onRunAction("ask");
                      return;
                    }
                    onRunAction(action.kind);
                  }}
                  className={cn(
                    "flex h-9 items-center justify-center gap-1.5 rounded-full border px-2 text-[11px] font-semibold transition-colors",
                    isActive
                      ? "border-island-gold/35 bg-island-gold/14 text-island-gold"
                      : "border-white/40 bg-white/48 text-foreground/62 hover:bg-white/70 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/9",
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

          <div className="mt-3 rounded-[20px] border border-white/35 bg-white/38 p-2.5 dark:border-white/8 dark:bg-white/4">
            <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground/42">
              <Languages className="h-3.5 w-3.5 text-island-gold/70" />
              <span>{t("island.selection.translateDirection")}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {translationPresets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  disabled={isBusy}
                  onClick={() => runTranslate(preset)}
                  className={cn(
                    "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-[10px] font-medium transition-colors",
                    selectedTarget === preset.target
                      ? "border-island-gold/35 bg-island-gold/12 text-island-gold"
                      : "border-white/35 bg-white/45 text-foreground/55 hover:bg-white/70 dark:border-white/10 dark:bg-white/5",
                  )}
                >
                  {selectedTarget === preset.target ? (
                    <Check className="h-3 w-3" />
                  ) : null}
                  {preset.label}
                </button>
              ))}
              <input
                value={customTarget}
                onChange={(event) => setCustomTarget(event.target.value)}
                placeholder={t("island.selection.customTarget")}
                className="h-7 min-w-[124px] flex-1 rounded-full border border-white/35 bg-white/45 px-2.5 text-[10px] text-foreground/70 outline-none placeholder:text-foreground/35 focus:border-island-gold/35 dark:border-white/10 dark:bg-white/5"
              />
            </div>
          </div>

          {activeAction === "ask" ? (
            <div className="mt-3 flex gap-2">
              <div className="min-w-0 flex-1 rounded-full border border-white/35 bg-white/48 px-3 py-2 dark:border-white/10 dark:bg-white/5">
                <input
                  value={askQuestion}
                  onChange={(event) => setAskQuestion(event.target.value)}
                  placeholder={t("island.selection.askPlaceholder")}
                  className="w-full bg-transparent text-[12px] text-foreground/76 outline-none placeholder:text-foreground/38"
                />
              </div>
              <button
                type="button"
                disabled={isBusy || askQuestion.trim().length === 0}
                onClick={() =>
                  onRunAction("ask", { question: askQuestion.trim() })
                }
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(180deg,rgba(229,216,197,0.72),rgba(245,239,230,0.48))] text-island-gold shadow-[0_10px_22px_-16px_rgba(0,0,0,0.32)] transition-transform hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-[linear-gradient(180deg,rgba(60,47,32,0.82),rgba(32,26,21,0.96))]"
                aria-label={t("island.selection.askSend")}
                title={t("island.selection.askSend")}
              >
                <MessageSquareText className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <div className="rounded-[20px] border border-amber-300/35 bg-amber-50/70 px-3 py-3 text-[12px] leading-5 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/25 dark:text-amber-200">
          {t("island.selection.empty")}
        </div>
      )}
    </div>
  );
}
