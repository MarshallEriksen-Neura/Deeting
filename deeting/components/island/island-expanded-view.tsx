"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftRight,
  ChevronUp,
  ClipboardPaste,
  Copy,
  CornerLeftDown,
  Languages,
  Loader2,
  Maximize2,
  MessageSquareText,
  Play,
  SendHorizontal,
  Sparkles,
  User,
  X,
} from "lucide-react";
import { motion, type Variants } from "framer-motion";

import { useI18n } from "@/hooks/use-i18n";
import { cn } from "@/lib/utils";
import { MarkdownViewer } from "@/components/chat/markdown-viewer";
import {
  ISLAND_TTS_AGENT_NOT_CONFIGURED,
  ISLAND_TTS_AUDIO_EMPTY,
  listIslandTextToSpeechAgents,
  quickTranslateIsland,
  speakIslandText,
  type IslandChatRequestConfig,
  type IslandTextToSpeechAgent,
} from "@/lib/api/island";
import AudioResultPanel, {
  type AudioResultPayload,
} from "@/components/audio/audio-result-panel";
import type { IslandRecentMessage } from "./island-store";

import { IslandApprovalCard } from "./island-approval-card";
import { resolveIslandStatusLabelKey } from "./island-labels";
import { IslandQuickReply } from "./island-quick-reply";
import { IslandSelectionPanel } from "./island-selection-panel";
import { IslandSeedLogo } from "./island-seed-logo";
import { IslandTranslatorLanguagePicker } from "./island-translator-language-picker";
import {
  persistRecentTargets,
  persistVoiceAgentId,
  pushRecentTarget,
  readFavoriteTargets,
  readStoredVoiceAgentId,
  readStoredRecentTargets,
  readTranslatorAutomation,
} from "./island-translator-preferences";
import { detectTextLanguage } from "./detect-text-language";
import { useIslandContext } from "./island-context";
import type {
  IslandBrowserLookupHit,
  IslandBrowserLookupPayload,
} from "./browser-lookup-types";
import type { IslandSelectionContext } from "./selection-context-types";

const containerVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.04, delayChildren: 0.06 } },
};
const itemVariants: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", damping: 20, stiffness: 300 },
  },
};

function findLatestRecentMessage(
  messages: IslandRecentMessage[],
  role: IslandRecentMessage["role"],
) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === role) {
      return messages[index];
    }
  }
  return null;
}

function IslandUserIntentChip({
  message,
  requestLabel,
}: {
  message: IslandRecentMessage;
  requestLabel: string;
}) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[82%] rounded-[22px] border border-island-gold/30 bg-[linear-gradient(180deg,rgba(245,239,230,0.92),rgba(245,239,230,0.72))] px-3.5 py-2.5 shadow-[0_10px_28px_-18px_rgba(0,0,0,0.25)] dark:bg-[linear-gradient(180deg,rgba(39,31,20,0.92),rgba(31,24,16,0.76))]">
        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-island-gold/85">
          <User className="h-3 w-3 shrink-0" />
          <span>{requestLabel}</span>
        </div>
        <p className="line-clamp-3 whitespace-pre-wrap break-words text-[12px] leading-5 text-foreground/88">
          {message.content}
        </p>
      </div>
    </div>
  );
}

function IslandAssistantPanel({
  message,
  isActive,
  compact = false,
  responseTitle,
  liveBadge,
  latestBadge,
  emptyText,
  approvalEmptyText,
  openTranslatorLabel,
  onOpenTranslator,
}: {
  message: IslandRecentMessage | null;
  isActive: boolean;
  compact?: boolean;
  responseTitle: string;
  liveBadge: string;
  latestBadge: string;
  emptyText: string;
  approvalEmptyText: string;
  openTranslatorLabel?: string;
  onOpenTranslator?: () => void;
}) {
  return (
    <div className="relative px-4 py-4">
      <div className="pointer-events-none absolute inset-0 rounded-full bg-[radial-gradient(circle_at_center,rgba(212,184,150,0.12),transparent_60%)] blur-2xl dark:bg-[radial-gradient(circle_at_center,rgba(212,184,150,0.08),transparent_60%)]" />
      <div className="relative flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-island-gold/25 bg-white/65 shadow-[0_8px_20px_-14px_rgba(0,0,0,0.28)] dark:bg-white/8">
            <IslandSeedLogo size={18} isActive={isActive} />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground/45">
              Deeting
            </div>
            <div className="text-[13px] font-semibold text-foreground/88">
              {responseTitle}
            </div>
          </div>
        </div>
        <div className="rounded-full border border-island-gold/20 bg-white/55 px-2.5 py-1 text-[10px] font-medium text-foreground/55 dark:bg-white/6">
          {isActive ? liveBadge : latestBadge}
        </div>
      </div>

      <div
        className={cn(
          "relative mt-4",
          compact ? "min-h-[160px]" : "min-h-[280px]",
        )}
      >
        {message ? (
          <div className="break-words text-[13px] leading-6 text-foreground/86">
            <MarkdownViewer
              content={message.content}
              className="chat-markdown chat-markdown-assistant text-[13px] leading-6"
            />
          </div>
        ) : (
          <div
            className={cn(
              "flex h-full flex-col items-center justify-center gap-2 text-center",
              compact ? "min-h-[160px]" : "min-h-[280px]",
            )}
          >
            <Sparkles className="h-5 w-5 text-island-gold/75" />
            <p className="max-w-[240px] text-[12px] leading-5 text-foreground/48">
              {compact ? approvalEmptyText : emptyText}
            </p>
            {!compact && onOpenTranslator ? (
              <button
                type="button"
                onClick={onOpenTranslator}
                className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-full border border-island-gold/22 bg-island-gold/10 px-3 text-[11px] font-semibold text-island-gold shadow-[0_10px_22px_-18px_rgba(0,0,0,0.28)] transition-colors hover:bg-island-gold/16"
              >
                <Languages className="h-3.5 w-3.5" />
                <span>{openTranslatorLabel}</span>
              </button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function buildBrowserLookupPrompt(
  lookup: IslandBrowserLookupPayload,
  hit: IslandBrowserLookupHit,
) {
  const sourceLabel = hit.source === "wiki" ? "wiki" : "memory"
  return [
    `Please use this local ${sourceLabel} context while helping me understand the current page.`,
    `Source title: ${hit.title}`,
    hit.subtitle ? `Source detail: ${hit.subtitle}` : null,
    `Summary: ${hit.summary}`,
    `Current page: ${lookup.pageContext.title || lookup.pageContext.url}`,
  ]
    .filter(Boolean)
    .join("\n")
}

function buildAskCurrentPagePrompt(lookup: IslandBrowserLookupPayload) {
  return [
    "Please explain the current page using the attached browser page context.",
    `Current page: ${lookup.pageContext.title || lookup.pageContext.url}`,
    lookup.pageContext.headingsSummary.length > 0
      ? `Visible headings: ${lookup.pageContext.headingsSummary.join(" | ")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n")
}

function IslandBrowserLookupCard({
  lookup,
  onAttach,
  onDismiss,
  title,
  attachLabel,
  dismissLabel,
}: {
  lookup: IslandBrowserLookupPayload
  onAttach: (lookupId: string, prompt: string) => void
  onDismiss: (lookupId: string) => void
  title: string
  attachLabel: string
  dismissLabel: string
}) {
  const isAskCurrentPage = lookup.kind === "ask_current_page"

  return (
    <div className="rounded-[26px] border border-white/40 bg-white/42 p-3 shadow-[0_18px_42px_-34px_rgba(0,0,0,0.35)] dark:border-white/8 dark:bg-white/4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/44">
            {title}
          </div>
          <div className="mt-1 text-[12px] leading-5 text-foreground/65">
            {lookup.pageContext.title || lookup.pageContext.url}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onDismiss(lookup.lookupId)}
          className="rounded-full border border-white/40 px-2.5 py-1 text-[11px] text-foreground/55 transition-colors hover:bg-white/55 dark:border-white/10 dark:hover:bg-white/8"
        >
          {dismissLabel}
        </button>
      </div>
      {isAskCurrentPage ? (
        <div className="rounded-[20px] border border-white/35 bg-[linear-gradient(180deg,rgba(255,255,255,0.78),rgba(245,239,230,0.52))] px-3 py-3 dark:border-white/8 dark:bg-[linear-gradient(180deg,rgba(55,45,31,0.78),rgba(24,22,20,0.92))]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground/40">
                current page
              </div>
              <div className="mt-1 text-[13px] font-semibold leading-5 text-foreground/86">
                {lookup.pageContext.title || lookup.pageContext.url}
              </div>
              <div className="mt-2 text-[12px] leading-5 text-foreground/68">
                Bring this page into chat with its transient browser context attached.
              </div>
            </div>
            <button
              type="button"
              onClick={() => onAttach(lookup.lookupId, buildAskCurrentPagePrompt(lookup))}
              className="shrink-0 rounded-full bg-[linear-gradient(180deg,rgba(229,216,197,0.72),rgba(245,239,230,0.48))] px-3 py-1.5 text-[11px] font-semibold text-island-gold shadow-[0_10px_22px_-16px_rgba(0,0,0,0.32)] transition-transform hover:scale-[1.02] dark:bg-[linear-gradient(180deg,rgba(60,47,32,0.82),rgba(32,26,21,0.96))]"
            >
              {attachLabel}
            </button>
          </div>
        </div>
      ) : (
        <div className="grid gap-2.5">
          {lookup.hits.slice(0, 3).map((hit) => (
            <div
              key={hit.id}
              className="rounded-[20px] border border-white/35 bg-[linear-gradient(180deg,rgba(255,255,255,0.78),rgba(245,239,230,0.52))] px-3 py-3 dark:border-white/8 dark:bg-[linear-gradient(180deg,rgba(55,45,31,0.78),rgba(24,22,20,0.92))]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground/40">
                    {hit.source}
                  </div>
                  <div className="mt-1 text-[13px] font-semibold leading-5 text-foreground/86">
                    {hit.title}
                  </div>
                  {hit.subtitle ? (
                    <div className="mt-1 text-[11px] text-foreground/45">
                      {hit.subtitle}
                    </div>
                  ) : null}
                  <div className="mt-2 text-[12px] leading-5 text-foreground/68">
                    {hit.summary}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onAttach(lookup.lookupId, buildBrowserLookupPrompt(lookup, hit))}
                  className="shrink-0 rounded-full bg-[linear-gradient(180deg,rgba(229,216,197,0.72),rgba(245,239,230,0.48))] px-3 py-1.5 text-[11px] font-semibold text-island-gold shadow-[0_10px_22px_-16px_rgba(0,0,0,0.32)] transition-transform hover:scale-[1.02] dark:bg-[linear-gradient(180deg,rgba(60,47,32,0.82),rgba(32,26,21,0.96))]"
                >
                  {attachLabel}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export type IslandTranslatorPhase =
  | "idle"
  | "translating"
  | "completed"
  | "failed";

type IslandTranslatorSpeechPhase =
  | "idle"
  | "speaking"
  | "completed"
  | "failed";

export interface IslandTranslatorMode {
  source: "selection" | "manual";
  selectionId: string | null;
  initialText: string;
  /** undefined === "Auto" (let the model detect the source). */
  sourceLanguage?: string;
  targetLanguage: string;
  /** When true, the view kicks off one translation right after open. */
  autoRun: boolean;
  /**
   * Increments per explicit user action (re-clicking translate from the
   * selection panel) so the view can detect "same text, new intent" cases
   * and re-run the translation even when the seed contents didn't change.
   */
  intentToken: number;
}

export interface IslandTranslatorHeaderState {
  phase: IslandTranslatorPhase;
  /** Display label for the current source language (resolves "Auto"). */
  sourceLabel: string;
  /** Display label for the current target language. */
  targetLabel: string;
}

function fingerprintTranslatorMode(mode: IslandTranslatorMode): string {
  return [
    mode.source,
    mode.selectionId ?? "",
    mode.initialText,
    mode.sourceLanguage ?? "",
    mode.targetLanguage,
    String(mode.intentToken),
  ].join("");
}

function makeTranslateDedupeKey(
  text: string,
  source: string | undefined,
  target: string,
): string {
  return [source ?? "", target, text].join("");
}

function IslandTranslatorView({
  mode,
  chatRequestConfig,
  pendingSelection,
  onClose,
  onHeaderStateChange,
  onAdoptSelection,
}: {
  mode: IslandTranslatorMode;
  chatRequestConfig?: IslandChatRequestConfig | null;
  pendingSelection?: IslandSelectionContext | null;
  onClose: () => void;
  onHeaderStateChange?: (state: IslandTranslatorHeaderState) => void;
  onAdoptSelection?: (selectionId: string) => void;
}) {
  const t = useI18n("chat");

  // Bounded language state — undefined source means "Auto".
  const [sourceLanguage, setSourceLanguage] = useState<string | undefined>(
    mode.sourceLanguage,
  );
  const [targetLanguage, setTargetLanguage] = useState<string>(
    mode.targetLanguage,
  );
  const [input, setInput] = useState<string>(mode.initialText);
  const [output, setOutput] = useState<string>("");
  const [phase, setPhase] = useState<IslandTranslatorPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [speechPhase, setSpeechPhase] =
    useState<IslandTranslatorSpeechPhase>("idle");
  const [speechPayload, setSpeechPayload] =
    useState<AudioResultPayload | null>(null);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [voiceAgents, setVoiceAgents] = useState<IslandTextToSpeechAgent[]>([]);
  const [voiceAgentsLoaded, setVoiceAgentsLoaded] = useState(false);
  const [voiceAgentsError, setVoiceAgentsError] = useState<string | null>(null);
  const [selectedVoiceAgentId, setSelectedVoiceAgentId] = useState<
    string | null
  >(() => readStoredVoiceAgentId());

  // Storage-backed picker data; keep in sync with selection panel.
  const [recent, setRecent] = useState<string[]>(() => readStoredRecentTargets());
  const [favorites, setFavorites] = useState<string[]>(() => readFavoriteTargets());

  // Smart-coupling surfaces: clipboard chip, bridged selection banner, drop overlay.
  const [clipboardCandidate, setClipboardCandidate] = useState<string | null>(
    null,
  );
  const [bridgedSelection, setBridgedSelection] =
    useState<IslandSelectionContext | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  // Tracks paste events so the next setInput from React's onChange can trigger
  // an auto-translate without re-implementing the textarea's value pipeline.
  const pendingPasteRef = useRef(false);
  // Remember which selection ids the user has already seen / dismissed in
  // this translator session so the banner doesn't keep re-appearing.
  const lastBridgedSelectionIdRef = useRef<string | null>(
    mode.selectionId ?? null,
  );

  const refreshPreferences = useCallback(() => {
    setRecent(readStoredRecentTargets());
    setFavorites(readFavoriteTargets());
  }, []);

  const refreshVoiceAgents = useCallback(async () => {
    try {
      const agents = await listIslandTextToSpeechAgents();
      setVoiceAgents(agents);
      setVoiceAgentsLoaded(true);
      setVoiceAgentsError(null);
    } catch {
      setVoiceAgents([]);
      setVoiceAgentsLoaded(true);
      setVoiceAgentsError(t("island.translator.voiceAgentLoadFailed"));
    }
  }, [t]);

  const resetSpeech = useCallback(() => {
    setSpeechPhase("idle");
    setSpeechPayload(null);
    setSpeechError(null);
  }, []);

  // Re-pull preferences whenever the popover-host page regains focus or
  // the mode reseeds, so config-sheet edits in the main window are picked up.
  useEffect(() => {
    if (typeof window === "undefined") return;
    function onFocus() {
      refreshPreferences();
      void refreshVoiceAgents();
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshPreferences, refreshVoiceAgents]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    void refreshVoiceAgents();
  }, [refreshVoiceAgents]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Detection hint reflects the current input, not the seed, so manual entry
  // shows what we think the user just typed.
  const detected = useMemo(() => {
    const trimmed = input.trim();
    if (!trimmed) return null;
    const detection = detectTextLanguage(trimmed);
    if (detection.code === "unknown") return null;
    return detection;
  }, [input]);

  const selectedVoiceAgent = useMemo(() => {
    const selectedId = selectedVoiceAgentId?.trim();
    if (selectedId) {
      const selected = voiceAgents.find((agent) => agent.id === selectedId);
      if (selected) return selected;
    }
    return (
      voiceAgents.find((agent) => agent.discoverable) ??
      voiceAgents[0] ??
      null
    );
  }, [selectedVoiceAgentId, voiceAgents]);

  // Tracking refs for mode resets and auto-run dedupe.
  const lastModeFingerprintRef = useRef<string | null>(null);
  const lastTranslatedKeyRef = useRef<string | null>(null);

  // Hoisted translate function — used by the auto-run path AND by the
  // explicit translate button.
  const performTranslate = useCallback(
    async (
      text: string,
      source: string | undefined,
      target: string,
    ): Promise<void> => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (!chatRequestConfig) {
        setError(t("island.translator.noModel"));
        setPhase("failed");
        return;
      }
      const dedupeKey = makeTranslateDedupeKey(trimmed, source, target);
      lastTranslatedKeyRef.current = dedupeKey;
      setPhase("translating");
      setError(null);
      resetSpeech();
      try {
        const result = await quickTranslateIsland({
          text: trimmed,
          sourceLanguage: source,
          targetLanguage: target,
          requestConfig: chatRequestConfig,
        });
        setOutput(result.text);
        setTargetLanguage(result.targetLanguage);
        setPhase("completed");
        const next = pushRecentTarget(
          readStoredRecentTargets(),
          result.targetLanguage,
        );
        persistRecentTargets(next);
        setRecent(next);
      } catch (translateError) {
        const message =
          translateError instanceof Error
            ? translateError.message
            : t("island.translator.failed");
        setError(message);
        setPhase("failed");
      }
    },
    [chatRequestConfig, resetSpeech, t],
  );

  // Reset state when the mode reseeds (new selection / new manual open).
  // Auto-run if the mode declares it. Otherwise, fall back to the clipboard
  // smart-seed so the user doesn't have to paste manually.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const fingerprint = fingerprintTranslatorMode(mode);
    if (lastModeFingerprintRef.current === fingerprint) return;
    lastModeFingerprintRef.current = fingerprint;

    setSourceLanguage(mode.sourceLanguage);
    setTargetLanguage(mode.targetLanguage);
    setInput(mode.initialText);
    setOutput("");
    setError(null);
    setPhase("idle");
    resetSpeech();
    lastTranslatedKeyRef.current = null;
    pendingPasteRef.current = false;
    setClipboardCandidate(null);
    setBridgedSelection(null);
    lastBridgedSelectionIdRef.current = mode.selectionId ?? null;

    if (mode.autoRun && mode.initialText.trim().length > 0) {
      void performTranslate(
        mode.initialText,
        mode.sourceLanguage,
        mode.targetLanguage,
      );
      return;
    }

    // Manual open with no seed text — try the clipboard so the user can
    // translate the thing they just copied without round-tripping through
    // paste + click. We deliberately read prefs at runtime to keep the effect
    // free of preference-induced re-runs.
    if (!mode.initialText.trim()) {
      const prefs = readTranslatorAutomation();
      if (prefs.clipboardSeedMode === "off") return;
      if (typeof navigator === "undefined" || !navigator.clipboard) return;
      navigator.clipboard
        .readText()
        .then((text) => {
          const trimmed = (text ?? "").trim();
          // 2 char floor filters out stray single keystrokes left in the
          // pasteboard from focus-leaving shortcuts.
          if (trimmed.length < 2) return;
          if (prefs.clipboardSeedMode === "auto") {
            setInput(trimmed);
            void performTranslate(
              trimmed,
              mode.sourceLanguage,
              mode.targetLanguage,
            );
          } else {
            setClipboardCandidate(trimmed);
          }
        })
        .catch(() => {
          /* clipboard permission denied / unsupported — silently skip */
        });
    }
  }, [mode, performTranslate, resetSpeech]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Selection bridge: when the user makes a fresh selection in another app
  // while the translator is open, surface it inline as a one-tap banner
  // instead of forcing them to close + re-open the translator.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!pendingSelection) {
      setBridgedSelection(null);
      return;
    }
    // The current seed already came from this selection; no banner needed.
    if (pendingSelection.selectionId === mode.selectionId) {
      setBridgedSelection(null);
      return;
    }
    // User already saw and acted on (or dismissed) this selection.
    if (pendingSelection.selectionId === lastBridgedSelectionIdRef.current) {
      return;
    }
    setBridgedSelection(pendingSelection);
  }, [pendingSelection, mode.selectionId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Report header state up so the island shell can replace its chat status
  // with translator-specific copy.
  useEffect(() => {
    onHeaderStateChange?.({
      phase,
      sourceLabel: sourceLanguage ?? t("island.translator.auto"),
      targetLabel: targetLanguage,
    });
  }, [phase, sourceLanguage, targetLanguage, onHeaderStateChange, t]);

  async function handleTranslateClick() {
    await performTranslate(input, sourceLanguage, targetLanguage);
  }

  async function handleCopyOutput() {
    if (!output.trim()) return;
    try {
      await navigator.clipboard.writeText(output);
    } catch {
      /* clipboard may be denied in some windows; ignored intentionally */
    }
  }

  async function handleSpeakOutput() {
    const text = output.trim();
    if (!text) return;
    if (voiceAgentsLoaded && voiceAgents.length === 0) {
      setSpeechError(t("island.translator.noVoiceAgent"));
      setSpeechPhase("failed");
      return;
    }
    setSpeechPhase("speaking");
    setSpeechPayload(null);
    setSpeechError(null);
    try {
      const result = await speakIslandText({
        text,
        agentId: selectedVoiceAgent?.id ?? selectedVoiceAgentId,
      });
      setSelectedVoiceAgentId(result.agentId);
      persistVoiceAgentId(result.agentId);
      setSpeechPayload(result.payload as AudioResultPayload);
      setSpeechPhase("completed");
    } catch (speakError) {
      const agentName =
        selectedVoiceAgent?.name ?? t("island.translator.voiceAgentUnavailable");
      const message =
        speakError instanceof Error &&
        speakError.message === ISLAND_TTS_AGENT_NOT_CONFIGURED
          ? t("island.translator.noVoiceAgent")
          : speakError instanceof Error &&
              speakError.message === ISLAND_TTS_AUDIO_EMPTY
            ? t("island.translator.speakFailed")
            : speakError instanceof Error
              ? t("island.translator.speakFailedWithAgent", {
                  name: agentName,
                  error: speakError.message,
                })
              : t("island.translator.speakFailed");
      setSpeechError(message);
      setSpeechPhase("failed");
    }
  }

  function handleSwapLanguages() {
    const previousSource = sourceLanguage;
    const previousTarget = targetLanguage;
    // Swap the two slots. If source was "Auto" we have to land on a concrete
    // language for target — fall back to English so the user is never stuck.
    const nextTarget = previousSource ?? "English";
    setSourceLanguage(previousTarget);
    setTargetLanguage(nextTarget);
    if (output.trim().length > 0) {
      // Move the translated text into the input so the user can re-translate it.
      setInput(output);
      setOutput("");
      setError(null);
      setPhase("idle");
      resetSpeech();
      lastTranslatedKeyRef.current = null;
    }
  }

  function handleUseOutputAsInput() {
    if (!output.trim()) return;
    setInput(output);
    setOutput("");
    setError(null);
    setPhase("idle");
    resetSpeech();
    lastTranslatedKeyRef.current = null;
  }

  function handleAdoptClipboardCandidate() {
    if (!clipboardCandidate) return;
    const text = clipboardCandidate;
    setClipboardCandidate(null);
    setInput(text);
    void performTranslate(text, sourceLanguage, targetLanguage);
  }

  function handleDismissClipboardCandidate() {
    setClipboardCandidate(null);
  }

  function handleAdoptBridgedSelection() {
    if (!bridgedSelection) return;
    const sel = bridgedSelection;
    lastBridgedSelectionIdRef.current = sel.selectionId;
    setBridgedSelection(null);
    setInput(sel.text);
    // Adopt the detected source language so "Auto" doesn't second-guess us.
    const detectedSource =
      sel.detectedLanguage.code !== "unknown"
        ? sel.detectedLanguage.displayName
        : sourceLanguage;
    if (detectedSource !== sourceLanguage) {
      setSourceLanguage(detectedSource);
    }
    void performTranslate(sel.text, detectedSource, targetLanguage);
    onAdoptSelection?.(sel.selectionId);
  }

  function handleDismissBridgedSelection() {
    if (!bridgedSelection) return;
    lastBridgedSelectionIdRef.current = bridgedSelection.selectionId;
    setBridgedSelection(null);
  }

  function handleInputChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    const next = event.target.value;
    setInput(next);
    // The flag was set by the preceding paste event; React fires onPaste
    // before onChange, so by the time we land here the textarea value
    // already reflects the pasted contents.
    if (pendingPasteRef.current) {
      pendingPasteRef.current = false;
      const trimmed = next.trim();
      if (trimmed.length < 2) return;
      const prefs = readTranslatorAutomation();
      if (!prefs.autoTranslateOnPaste) return;
      void performTranslate(next, sourceLanguage, targetLanguage);
    }
  }

  function handleInputPaste() {
    // Don't translate from the raw clipboardData here — let the textarea
    // resolve composition / selection-replace semantics first, then react in
    // onChange. This keeps the auto-translate aligned with what the user
    // actually sees in the field.
    pendingPasteRef.current = true;
  }

  function handleCardDragOver(event: React.DragEvent<HTMLDivElement>) {
    const types = event.dataTransfer?.types;
    if (!types) return;
    const hasText =
      Array.prototype.includes.call(types, "text/plain") ||
      Array.prototype.includes.call(types, "Files");
    if (!hasText) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    if (!isDragOver) setIsDragOver(true);
  }

  function handleCardDragLeave(event: React.DragEvent<HTMLDivElement>) {
    // Ignore leave events that bubble from inner elements within the card.
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }
    setIsDragOver(false);
  }

  async function handleCardDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragOver(false);
    const dt = event.dataTransfer;
    if (!dt) return;
    let text = dt.getData("text/plain");
    if (!text && dt.files.length > 0) {
      const file = dt.files[0];
      if (file.type.startsWith("text/") || /\.(md|markdown|txt)$/i.test(file.name)) {
        try {
          text = await file.text();
        } catch {
          /* unreadable file — give up silently */
        }
      }
    }
    const trimmed = text.trim();
    if (!trimmed) return;
    setInput(trimmed);
    void performTranslate(trimmed, sourceLanguage, targetLanguage);
  }

  const isTranslating = phase === "translating";
  const isSpeaking = speechPhase === "speaking";
  const inputCharCount = input.trim().length;
  const voiceSelectValue = selectedVoiceAgent?.id ?? "";
  const voiceSelectDisabled = isSpeaking || voiceAgents.length === 0;

  return (
    <div
      onDragOver={handleCardDragOver}
      onDragLeave={handleCardDragLeave}
      onDrop={(event) => {
        void handleCardDrop(event);
      }}
      className={cn(
        "relative rounded-[26px] border border-white/40 bg-white/42 p-3 shadow-[0_18px_42px_-34px_rgba(0,0,0,0.35)] transition-shadow dark:border-white/8 dark:bg-white/4",
        isDragOver &&
          "ring-2 ring-island-gold/55 ring-offset-2 ring-offset-background",
      )}
    >
      {isDragOver ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[26px] bg-island-gold/8 backdrop-blur-[2px]">
          <div className="rounded-full border border-island-gold/35 bg-background/85 px-3 py-1.5 text-[11px] font-semibold text-island-gold shadow-[0_10px_22px_-16px_rgba(0,0,0,0.32)]">
            {t("island.translator.dropHint")}
          </div>
        </div>
      ) : null}
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-island-gold/25 bg-island-gold/10 text-island-gold">
            <Languages className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/44">
              {t("island.translator.title")}
            </div>
            <div className="mt-0.5 truncate text-[12px] text-foreground/58">
              {t("island.translator.subtitle")}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-full border border-white/40 px-2.5 py-1 text-[11px] text-foreground/55 transition-colors hover:bg-white/55 dark:border-white/10 dark:hover:bg-white/8"
        >
          {t("island.translator.close")}
        </button>
      </div>

      <div className="mb-2 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
        <IslandTranslatorLanguagePicker
          kind="source"
          value={sourceLanguage}
          onChange={(next) => setSourceLanguage(next)}
          detected={detected ? { displayName: detected.displayName } : null}
          recent={recent}
          favorites={favorites}
          disabled={isTranslating}
        />
        <button
          type="button"
          onClick={handleSwapLanguages}
          disabled={isTranslating}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-white/38 bg-white/45 text-foreground/52 transition-colors hover:bg-white/65 hover:text-island-gold disabled:cursor-not-allowed disabled:opacity-55 dark:border-white/10 dark:bg-white/6"
          aria-label={t("island.translator.swap")}
          title={t("island.translator.swap")}
        >
          <ArrowLeftRight className="h-3.5 w-3.5" />
        </button>
        <IslandTranslatorLanguagePicker
          kind="target"
          value={targetLanguage}
          onChange={(next) => {
            if (next === undefined || !next.trim()) return;
            setTargetLanguage(next);
          }}
          recent={recent}
          favorites={favorites}
          disabled={isTranslating}
        />
      </div>

      <textarea
        value={input}
        onChange={handleInputChange}
        onPaste={handleInputPaste}
        placeholder={t("island.translator.inputPlaceholder")}
        className="min-h-[118px] w-full resize-none rounded-[20px] border border-foreground/12 bg-white/58 px-3 py-2.5 text-[13px] leading-6 text-foreground/82 outline-none focus:border-island-gold/40 dark:bg-white/6"
      />

      {bridgedSelection ? (
        <div className="mt-2 flex items-center gap-2 rounded-[18px] border border-island-gold/35 bg-island-gold/10 px-2.5 py-1.5 text-[11px] text-foreground/78">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-island-gold" />
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-island-gold/85">
              {t("island.translator.bridgedSelection.title")}
            </div>
            <div className="mt-0.5 truncate text-[11px] text-foreground/70">
              {bridgedSelection.preview}
            </div>
          </div>
          <button
            type="button"
            onClick={handleAdoptBridgedSelection}
            disabled={isTranslating}
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full bg-island-gold/18 px-2.5 text-[10px] font-semibold text-island-gold transition-colors hover:bg-island-gold/28 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("island.translator.bridgedSelection.use")}
          </button>
          <button
            type="button"
            onClick={handleDismissBridgedSelection}
            aria-label={t("island.translator.bridgedSelection.dismiss")}
            title={t("island.translator.bridgedSelection.dismiss")}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-foreground/45 transition-colors hover:bg-white/55 hover:text-foreground/75 dark:hover:bg-white/8"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : null}

      {clipboardCandidate ? (
        <div className="mt-2 flex items-center gap-2 rounded-[18px] border border-foreground/12 bg-white/55 px-2.5 py-1.5 text-[11px] text-foreground/72 dark:border-white/10 dark:bg-white/6">
          <ClipboardPaste className="h-3.5 w-3.5 shrink-0 text-foreground/55" />
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground/45">
              {t("island.translator.clipboardSeed.title")}
            </div>
            <div className="mt-0.5 truncate text-[11px] text-foreground/68">
              {clipboardCandidate}
            </div>
          </div>
          <button
            type="button"
            onClick={handleAdoptClipboardCandidate}
            disabled={isTranslating}
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full bg-island-gold/15 px-2.5 text-[10px] font-semibold text-island-gold transition-colors hover:bg-island-gold/22 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("island.translator.clipboardSeed.use")}
          </button>
          <button
            type="button"
            onClick={handleDismissClipboardCandidate}
            aria-label={t("island.translator.clipboardSeed.dismiss")}
            title={t("island.translator.clipboardSeed.dismiss")}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-foreground/45 transition-colors hover:bg-white/55 hover:text-foreground/75 dark:hover:bg-white/8"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : null}

      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="min-w-0 text-[11px] text-foreground/45">
          {inputCharCount} {t("island.translator.characters")}
        </div>
        <button
          type="button"
          disabled={isTranslating || !input.trim()}
          onClick={() => void handleTranslateClick()}
          className="inline-flex h-8 items-center gap-1.5 rounded-full bg-island-gold/16 px-3 text-[11px] font-semibold text-island-gold transition-colors hover:bg-island-gold/24 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <SendHorizontal className="h-3.5 w-3.5" />
          {isTranslating
            ? t("island.translator.translating")
            : t("island.translator.translate")}
        </button>
      </div>

      <div className="my-3 flex items-center gap-2">
        <div className="h-px flex-1 bg-foreground/10" />
        <div className="rounded-full bg-background/72 px-2.5 py-1 text-[10px] font-medium text-foreground/50">
          {t("island.translator.outputLabel")}
        </div>
        <button
          type="button"
          disabled={
            !output.trim() ||
            isTranslating ||
            isSpeaking ||
            (voiceAgentsLoaded && voiceAgents.length === 0)
          }
          onClick={() => void handleSpeakOutput()}
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-island-gold/28 bg-island-gold/10 px-2.5 text-[10px] font-semibold text-island-gold transition-colors hover:bg-island-gold/18 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {isSpeaking ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Play className="h-3 w-3" />
          )}
          {isSpeaking
            ? t("island.translator.speaking")
            : t("island.translator.speak")}
        </button>
        <div className="h-px flex-1 bg-foreground/10" />
      </div>

      <div className="mb-2 flex items-center justify-between gap-2 rounded-[16px] border border-white/32 bg-white/34 px-2.5 py-2 dark:border-white/8 dark:bg-white/4">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground/40">
            {t("island.translator.voiceAgent")}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-foreground/58">
            {voiceAgentsError ??
              selectedVoiceAgent?.name ??
              (voiceAgentsLoaded
                ? t("island.translator.voiceAgentUnavailable")
                : t("island.translator.voiceAgentLoading"))}
          </div>
        </div>
        <select
          value={voiceSelectValue}
          disabled={voiceSelectDisabled}
          onChange={(event) => {
            const next = event.target.value.trim() || null;
            setSelectedVoiceAgentId(next);
            persistVoiceAgentId(next);
            resetSpeech();
          }}
          aria-label={t("island.translator.voiceAgent")}
          className="h-8 max-w-[48%] shrink-0 rounded-full border border-white/40 bg-white/58 px-2 text-[11px] font-medium text-foreground/70 outline-none transition-colors hover:border-island-gold/32 focus:border-island-gold/45 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-white/6"
        >
          {voiceAgents.length === 0 ? (
            <option value="">
              {voiceAgentsLoaded
                ? t("island.translator.voiceAgentUnavailable")
                : t("island.translator.voiceAgentLoading")}
            </option>
          ) : null}
          {voiceAgents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
      </div>

      <div className="min-h-[150px] rounded-[20px] border border-white/30 bg-white/40 px-3 py-3 text-[13px] leading-6 text-foreground/82 dark:border-white/8 dark:bg-white/5">
        {error ? (
          <div className="text-[12px] leading-5 text-amber-700 dark:text-amber-300">
            {error}
          </div>
        ) : output ? (
          <div className="whitespace-pre-wrap break-words">{output}</div>
        ) : (
          <div className="flex min-h-[120px] items-center justify-center text-center text-[12px] text-foreground/42">
            {isTranslating
              ? t("island.translator.translating")
              : t("island.translator.outputPlaceholder")}
          </div>
        )}
      </div>

      <div className="mt-2 flex justify-end gap-1.5">
        <button
          type="button"
          disabled={!output.trim() || isTranslating}
          onClick={handleUseOutputAsInput}
          className="inline-flex h-7 items-center gap-1.5 rounded-full border border-white/38 bg-white/38 px-2.5 text-[10px] font-semibold text-foreground/58 transition-colors hover:bg-white/58 disabled:cursor-not-allowed disabled:opacity-45 dark:border-white/10 dark:bg-white/5"
        >
          <CornerLeftDown className="h-3 w-3" />
          {t("island.translator.useAsInput")}
        </button>
        <button
          type="button"
          disabled={!output.trim()}
          onClick={() => void handleCopyOutput()}
          className="inline-flex h-7 items-center gap-1.5 rounded-full border border-white/38 bg-white/38 px-2.5 text-[10px] font-semibold text-foreground/58 transition-colors hover:bg-white/58 disabled:cursor-not-allowed disabled:opacity-45 dark:border-white/10 dark:bg-white/5"
        >
          <Copy className="h-3 w-3" />
          {t("island.translator.copy")}
        </button>
      </div>

      {speechError ? (
        <div className="mt-2 rounded-[16px] border border-amber-400/20 bg-amber-400/8 px-3 py-2 text-[11px] leading-5 text-amber-700 dark:text-amber-300">
          {speechError}
        </div>
      ) : null}

      {speechPayload ? (
        <div className="mt-2">
          <AudioResultPanel
            payload={speechPayload}
            autoPlay
            className="rounded-[18px] border-white/35 bg-white/45 p-3 dark:border-white/10 dark:bg-white/5"
          />
        </div>
      ) : null}
    </div>
  );
}

function resolveManualTranslatorTarget() {
  if (typeof navigator !== "undefined" && navigator.language?.startsWith("zh")) {
    return "Chinese";
  }
  if (
    typeof document !== "undefined" &&
    document.documentElement.lang?.startsWith("zh")
  ) {
    return "Chinese";
  }
  return "English";
}

export function IslandExpandedView({
  headerDragRegion = false,
}: {
  headerDragRegion?: boolean;
} = {}) {
  const {
    statusLabel,
    recentMessages,
    pendingApproval,
    browserLookup,
    selectionContext,
    chatRequestConfig,
    isBusy,
    errorMessage,
    collapse,
    startNewConversation,
    sendQuickReply,
    runSelectionAction,
    approvePendingApproval,
    rejectPendingApproval,
    restoreWorkspace,
    attachBrowserLookup,
    dismissBrowserLookup,
    dismissSelectionContext,
  } = useIslandContext();
  const t = useI18n("chat");

  const [translatorMode, setTranslatorMode] =
    useState<IslandTranslatorMode | null>(null);
  const [translatorHeader, setTranslatorHeader] =
    useState<IslandTranslatorHeaderState | null>(null);
  const intentTokenRef = useRef(0);

  const translatorOpen = translatorMode !== null;

  const closeTranslator = useCallback(() => {
    setTranslatorMode(null);
    setTranslatorHeader(null);
  }, []);

  const openSelectionTranslator = useCallback(
    (selection: typeof selectionContext, targetLanguage: string) => {
      if (!selection) return;
      intentTokenRef.current += 1;
      setTranslatorMode({
        source: "selection",
        selectionId: selection.selectionId,
        initialText: selection.text,
        sourceLanguage:
          selection.detectedLanguage.code !== "unknown"
            ? selection.detectedLanguage.displayName
            : undefined,
        targetLanguage,
        autoRun: true,
        intentToken: intentTokenRef.current,
      });
      // Reset header to a clean idle state until the view reports back.
      setTranslatorHeader({
        phase: "idle",
        sourceLabel:
          selection.detectedLanguage.code !== "unknown"
            ? selection.detectedLanguage.displayName
            : t("island.translator.auto"),
        targetLabel: targetLanguage,
      });
    },
    [t],
  );

  const openManualTranslator = useCallback(() => {
    intentTokenRef.current += 1;
    const target = resolveManualTranslatorTarget();
    setTranslatorMode({
      source: "manual",
      selectionId: null,
      initialText: "",
      sourceLanguage: undefined,
      targetLanguage: target,
      autoRun: false,
      intentToken: intentTokenRef.current,
    });
    setTranslatorHeader({
      phase: "idle",
      sourceLabel: t("island.translator.auto"),
      targetLabel: target,
    });
  }, [t]);

  const isActive =
    statusLabel === "Working..." || statusLabel === "Pending approval";
  const latestUserMessage = findLatestRecentMessage(recentMessages, "user");
  const latestAssistantMessage = findLatestRecentMessage(
    recentMessages,
    "assistant",
  );
  const isApprovalFocused = Boolean(pendingApproval);
  const statusLabelKey = resolveIslandStatusLabelKey(statusLabel);
  const sendFooterReply =
    selectionContext?.activeAction === "ask"
      ? (text: string) => runSelectionAction("ask", { question: text })
      : sendQuickReply;

  // Translator can be temporarily eclipsed by an approval card. When that
  // happens we want the chat footer to come back so the approval flow can
  // continue, but we still keep the translator mode alive so the user can
  // return to it once the approval clears.
  const showTranslatorCard = translatorOpen && !pendingApproval;
  const showFooter = !showTranslatorCard;

  // Header status: when translator is active and not eclipsed, replace the
  // chat status pill with translator-specific copy.
  const translatorPhaseLabel = translatorHeader
    ? translatorHeader.phase === "translating"
      ? t("island.translator.phaseTranslating")
      : translatorHeader.phase === "completed"
        ? t("island.translator.phaseCompleted")
        : translatorHeader.phase === "failed"
          ? t("island.translator.phaseFailed")
          : t("island.translator.phaseIdle")
    : null;
  const translatorIsBusy =
    translatorHeader?.phase === "translating";
  const translatorLanguagePair = translatorHeader
    ? t("island.translator.languagePair", {
        source: translatorHeader.sourceLabel,
        target: translatorHeader.targetLabel,
      })
    : null;
  const headerIsActive = showTranslatorCard
    ? translatorIsBusy
    : isActive;

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "100%" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ type: "spring", damping: 22, stiffness: 280 }}
      className="flex flex-col h-full overflow-hidden"
    >
      {/* Header - Pinned at top */}
      <motion.div
        data-tauri-drag-region={headerDragRegion ? "true" : undefined}
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="shrink-0"
      >
        <motion.div variants={itemVariants} className="px-3.5 py-3">
          <div className="flex items-center gap-2 rounded-[999px] border border-white/45 bg-[linear-gradient(180deg,rgba(255,255,255,0.82),rgba(244,238,232,0.62))] px-2.5 py-2 shadow-[0_14px_30px_-22px_rgba(0,0,0,0.32)] dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(47,38,27,0.92),rgba(24,21,18,0.92))]">
            <div className="flex items-center gap-2.5 rounded-full bg-white/55 px-2.5 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] dark:bg-white/6">
              <IslandSeedLogo size={18} isActive={headerIsActive} />
              <div className="flex items-center gap-1.5">
                <div className="relative flex h-2 w-2">
                  <span
                    className={cn(
                      "absolute inline-flex h-full w-full rounded-full opacity-75",
                      headerIsActive
                        ? "animate-ping bg-amber-400"
                        : "bg-emerald-400",
                    )}
                  />
                  <span
                    className={cn(
                      "relative inline-flex rounded-full h-2 w-2",
                      headerIsActive ? "bg-amber-400" : "bg-emerald-400",
                    )}
                  />
                </div>
                <span className="text-[11px] font-semibold text-foreground/76">
                  {showTranslatorCard && translatorPhaseLabel
                    ? `${t("island.translator.title")} · ${translatorPhaseLabel}`
                    : statusLabelKey
                      ? t(statusLabelKey)
                      : statusLabel}
                </span>
              </div>
            </div>
            <div className="min-w-0 flex-1 truncate rounded-full bg-white/45 px-3 py-1.5 text-[11px] text-foreground/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] dark:bg-white/6">
              {showTranslatorCard && translatorLanguagePair
                ? translatorLanguagePair
                : isApprovalFocused
                  ? t("island.hints.pending")
                  : isActive
                    ? t("island.hints.active")
                    : t("island.hints.idle")}
            </div>
            <button
              onClick={collapse}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-white/55 transition-colors hover:bg-island-gold/14 dark:bg-white/6"
            >
              <ChevronUp className="h-3.5 w-3.5 text-island-gold" />
            </button>
          </div>
        </motion.div>
      </motion.div>

      {/* Main Content Area - Scrollable */}
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="min-h-0 flex-1 overflow-y-auto island-content-scrollbar"
      >
        <motion.div variants={itemVariants} className="space-y-3 px-3.5 pb-3">
          {showTranslatorCard && translatorMode ? (
            <IslandTranslatorView
              mode={translatorMode}
              chatRequestConfig={chatRequestConfig}
              pendingSelection={selectionContext}
              onClose={closeTranslator}
              onHeaderStateChange={setTranslatorHeader}
              onAdoptSelection={(selectionId) => {
                void dismissSelectionContext(selectionId);
              }}
            />
          ) : pendingApproval ? (
            <motion.div variants={itemVariants}>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground/40">
                {t("island.approvalTitle")}
              </p>
              <IslandApprovalCard
                title={pendingApproval.title}
                desc={pendingApproval.desc}
                onApprove={approvePendingApproval}
                onReject={rejectPendingApproval}
                disabled={isBusy}
              />
            </motion.div>
          ) : null}
          {selectionContext && !pendingApproval && !showTranslatorCard ? (
            <IslandSelectionPanel
              selection={selectionContext}
              isBusy={isBusy}
              onOpenTranslator={(targetLanguage) => {
                openSelectionTranslator(selectionContext, targetLanguage);
              }}
              onRunAction={(kind, options) => {
                void runSelectionAction(kind, options);
              }}
              onDismiss={(selectionId) => {
                void dismissSelectionContext(selectionId);
              }}
            />
          ) : null}
          {!showTranslatorCard && browserLookup ? (
            <IslandBrowserLookupCard
              lookup={browserLookup}
              onAttach={(lookupId, prompt) => {
                void attachBrowserLookup(lookupId, prompt)
              }}
              onDismiss={(lookupId) => {
                void dismissBrowserLookup(lookupId)
              }}
              title={t("island.lookup.title")}
              attachLabel={t("island.lookup.attach")}
              dismissLabel={t("island.lookup.dismiss")}
            />
          ) : null}
          {!showTranslatorCard && latestUserMessage ? (
            <IslandUserIntentChip
              message={latestUserMessage}
              requestLabel={t("island.requestLabel")}
            />
          ) : null}
          {!showTranslatorCard ? (
            <IslandAssistantPanel
              message={latestAssistantMessage}
              isActive={isActive}
              compact={isApprovalFocused}
              responseTitle={t("island.responseTitle")}
              liveBadge={t("island.badges.live")}
              latestBadge={t("island.badges.latest")}
              emptyText={t("island.keepNearby")}
              approvalEmptyText={t("island.approvalEmpty")}
              openTranslatorLabel={t("island.translator.open")}
              onOpenTranslator={openManualTranslator}
            />
          ) : null}

          {!isApprovalFocused || showTranslatorCard ? null : (
            <div className="rounded-[22px] border border-white/35 bg-white/38 px-3.5 py-3 shadow-[0_12px_24px_-20px_rgba(0,0,0,0.26)] dark:border-white/8 dark:bg-white/4">
              <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/44">
                <MessageSquareText className="h-3.5 w-3.5 text-island-gold/72" />
                <span>{t("island.decisionTitle")}</span>
              </div>
              <p className="text-[12px] leading-5 text-foreground/62">
                {t("island.decisionDescription")}
              </p>
            </div>
          )}
        </motion.div>

        {errorMessage ? (
          <motion.div
            variants={itemVariants}
            className="mx-3.5 mb-3 rounded-[22px] border border-amber-300/40 bg-amber-50/70 px-3.5 py-3 text-[11px] text-amber-700 shadow-[0_14px_28px_-24px_rgba(120,53,15,0.4)] dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300"
          >
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-700/70 dark:text-amber-300/70">
              {t("island.attentionTitle")}
            </div>
            <div className="leading-5">{errorMessage}</div>
          </motion.div>
        ) : null}
      </motion.div>

      {/* Footer Area - Pinned at bottom */}
      {showFooter ? (
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="shrink-0 px-3.5 pb-3"
        >
        <motion.div
          variants={itemVariants}
          className="rounded-[26px] border border-white/40 bg-[linear-gradient(180deg,rgba(255,255,255,0.86),rgba(246,241,235,0.68))] p-2 shadow-[0_22px_48px_-32px_rgba(0,0,0,0.35)] dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(44,37,29,0.94),rgba(23,20,18,0.96))]"
        >
          <div className="flex items-center gap-2 rounded-[22px] bg-white/48 px-2.5 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.58)] dark:bg-white/5">
            <div className="hidden min-w-0 rounded-[18px] bg-white/42 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/42 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] md:block">
              {selectionContext?.activeAction === "ask"
                ? t("island.selection.askFooter")
                : t("island.continueHere")}
            </div>
            <div className="min-w-0 flex-1">
              <IslandQuickReply
                onSend={sendFooterReply}
                onNewConversation={startNewConversation}
                disabled={isBusy}
              />
            </div>
            <button
              type="button"
              onClick={openManualTranslator}
              aria-label={t("island.translator.open")}
              title={t("island.translator.open")}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/55 text-island-gold shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] transition-colors hover:bg-island-gold/14 dark:bg-white/6"
            >
              <Languages className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={restoreWorkspace}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-[linear-gradient(180deg,rgba(229,216,197,0.72),rgba(245,239,230,0.48))] text-island-gold shadow-[0_10px_22px_-16px_rgba(0,0,0,0.32)] transition-transform hover:scale-[1.02] dark:bg-[linear-gradient(180deg,rgba(60,47,32,0.82),rgba(32,26,21,0.96))]"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </motion.div>
        </motion.div>
      ) : null}
    </motion.div>
  );
}
