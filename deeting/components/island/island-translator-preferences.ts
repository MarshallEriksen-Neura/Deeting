"use client";

/**
 * Shared preference storage for island translation features.
 *
 * Both the selected-text translate split-button and the dedicated
 * translator mode read/write the same recent and favorite target lists,
 * so the user's intent is preserved across both entry points.
 */

export const RECENT_TARGETS_STORAGE_KEY = "island-selection-recent-targets";
export const FAVORITE_TARGETS_STORAGE_KEY =
  "island-selection-favorite-targets";
export const VOICE_AGENT_STORAGE_KEY = "island-translator-voice-agent-id";
export const TRANSLATOR_AUTOMATION_STORAGE_KEY =
  "island-translator-automation";
export const MAX_RECENT_TARGETS = 3;

export type ClipboardSeedMode = "ask" | "auto" | "off";

export interface IslandTranslatorAutomationPrefs {
  /** Translate immediately after a paste lands in the input. */
  autoTranslateOnPaste: boolean;
  /**
   * How the translator handles a non-empty clipboard when it opens with no
   * seed text. "ask" surfaces a one-tap chip; "auto" runs translation right
   * away; "off" disables the lookup entirely.
   */
  clipboardSeedMode: ClipboardSeedMode;
}

const DEFAULT_AUTOMATION: IslandTranslatorAutomationPrefs = {
  autoTranslateOnPaste: true,
  clipboardSeedMode: "ask",
};

export function readStoredRecentTargets(): string[] {
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

export function persistRecentTargets(targets: ReadonlyArray<string>): void {
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

export function pushRecentTarget(
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

export function persistFavoriteTargets(
  targets: ReadonlyArray<string>,
): void {
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

export function clearStoredRecentTargets(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(RECENT_TARGETS_STORAGE_KEY);
  } catch {
    /* swallow */
  }
}

export function readStoredVoiceAgentId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(VOICE_AGENT_STORAGE_KEY)?.trim();
    return value || null;
  } catch {
    /* swallow malformed storage */
  }
  return null;
}

export function persistVoiceAgentId(agentId: string | null): void {
  if (typeof window === "undefined") return;
  try {
    const value = agentId?.trim();
    if (value) {
      window.localStorage.setItem(VOICE_AGENT_STORAGE_KEY, value);
    } else {
      window.localStorage.removeItem(VOICE_AGENT_STORAGE_KEY);
    }
  } catch {
    /* swallow quota errors */
  }
}

function isClipboardSeedMode(value: unknown): value is ClipboardSeedMode {
  return value === "ask" || value === "auto" || value === "off";
}

export function readTranslatorAutomation(): IslandTranslatorAutomationPrefs {
  if (typeof window === "undefined") return { ...DEFAULT_AUTOMATION };
  try {
    const raw = window.localStorage.getItem(
      TRANSLATOR_AUTOMATION_STORAGE_KEY,
    );
    if (!raw) return { ...DEFAULT_AUTOMATION };
    const parsed = JSON.parse(raw) as Partial<IslandTranslatorAutomationPrefs>;
    return {
      autoTranslateOnPaste:
        typeof parsed.autoTranslateOnPaste === "boolean"
          ? parsed.autoTranslateOnPaste
          : DEFAULT_AUTOMATION.autoTranslateOnPaste,
      clipboardSeedMode: isClipboardSeedMode(parsed.clipboardSeedMode)
        ? parsed.clipboardSeedMode
        : DEFAULT_AUTOMATION.clipboardSeedMode,
    };
  } catch {
    /* swallow malformed storage */
  }
  return { ...DEFAULT_AUTOMATION };
}

export function persistTranslatorAutomation(
  prefs: IslandTranslatorAutomationPrefs,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      TRANSLATOR_AUTOMATION_STORAGE_KEY,
      JSON.stringify(prefs),
    );
  } catch {
    /* swallow quota errors */
  }
}
