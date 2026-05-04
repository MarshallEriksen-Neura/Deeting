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
export const MAX_RECENT_TARGETS = 3;

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
