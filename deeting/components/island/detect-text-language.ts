/**
 * Lightweight Unicode-range based language detection for selection text.
 *
 * Designed for the dynamic-island translate flow:
 * - No dependencies, sub-millisecond detection of short snippets
 * - Script-first (CJK/Cyrillic/Arabic), with Latin stopword fallback
 * - Returns BCP-47 base codes plus a canonical English display name suitable
 *   for prompt building and as a stable localStorage key
 *
 * This is intentionally a heuristic, not a full LID model. False positives on
 * very short Latin samples are acceptable because the UI also exposes recent
 * targets and a custom-language escape hatch.
 */

export type DetectedLanguageCode =
  | "zh"
  | "en"
  | "ja"
  | "ko"
  | "ar"
  | "ru"
  | "fr"
  | "de"
  | "es"
  | "pt"
  | "it"
  | "unknown"

export interface DetectedLanguage {
  code: DetectedLanguageCode
  /** Canonical English display name (used in prompts and as the localStorage value). */
  displayName: string
}

const DISPLAY_NAMES: Record<DetectedLanguageCode, string> = {
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
  unknown: "Unknown",
}

const NAME_TO_CODE: Record<string, DetectedLanguageCode> = Object.fromEntries(
  Object.entries(DISPLAY_NAMES).map(([code, name]) => [name.toLowerCase(), code as DetectedLanguageCode]),
)

const UNKNOWN: DetectedLanguage = { code: "unknown", displayName: DISPLAY_NAMES.unknown }

/**
 * Script-based detection. Order matters:
 *   - kana before CJK ideographs, so mixed Japanese (kana + kanji) wins over Chinese.
 *   - hangul before CJK ideographs, for the same reason with Korean hanja.
 */
const SCRIPT_PATTERNS: ReadonlyArray<{
  code: DetectedLanguageCode
  pattern: RegExp
}> = [
  // Hiragana (U+3040..U+309F) and Katakana (U+30A0..U+30FF)
  { code: "ja", pattern: /[぀-ゟ゠-ヿ]/ },
  // Hangul syllables (U+AC00..U+D7AF) + Jamo (U+1100..U+11FF) + compatibility Jamo (U+3130..U+318F)
  { code: "ko", pattern: /[가-힯ᄀ-ᇿ㄰-㆏]/ },
  // CJK Unified Ideographs (U+4E00..U+9FFF) + Extension A (U+3400..U+4DBF)
  { code: "zh", pattern: /[一-鿿㐀-䶿]/ },
  // Arabic (U+0600..U+06FF) + Arabic Supplement (U+0750..U+077F)
  { code: "ar", pattern: /[؀-ۿݐ-ݿ]/ },
  // Cyrillic (U+0400..U+04FF)
  { code: "ru", pattern: /[Ѐ-ӿ]/ },
]

/**
 * Latin stop-word hints. Only consulted when the text contains Latin letters
 * AND no script above matched. Each pattern requires word-boundary matches so
 * that English text (which has none of these stopwords as full tokens) falls
 * through to the English default.
 */
const LATIN_HINTS: ReadonlyArray<{
  code: DetectedLanguageCode
  pattern: RegExp
}> = [
  { code: "fr", pattern: /\b(le|la|les|et|est|une?|des|du|que|qui|avec|pour|sont|c'est)\b/i },
  { code: "de", pattern: /\b(der|die|das|und|ist|ein|eine|nicht|mit|für|auch|sind|haben)\b/i },
  { code: "es", pattern: /\b(el|los|las|y|es|un|una|del|que|con|para|por|pero|son|está)\b/i },
  { code: "pt", pattern: /\b(os|as|é|um|uma|do|da|que|com|para|por|mas|não|são|está)\b/i },
  { code: "it", pattern: /\b(il|i|le|è|un|una|del|della|che|con|per|sono|sta)\b/i },
]

export function detectTextLanguage(text: string): DetectedLanguage {
  const sample = text.trim()
  if (!sample) return UNKNOWN

  for (const { code, pattern } of SCRIPT_PATTERNS) {
    if (pattern.test(sample)) {
      return { code, displayName: DISPLAY_NAMES[code] }
    }
  }

  if (/[a-zA-Z]/.test(sample)) {
    for (const { code, pattern } of LATIN_HINTS) {
      if (pattern.test(sample)) {
        return { code, displayName: DISPLAY_NAMES[code] }
      }
    }
    return { code: "en", displayName: DISPLAY_NAMES.en }
  }

  return UNKNOWN
}

export function languageDisplayName(code: DetectedLanguageCode): string {
  return DISPLAY_NAMES[code]
}

/** Reverse lookup: turn a display name (any case) back into a code, or null. */
export function lookupLanguageCode(name: string): DetectedLanguageCode | null {
  if (!name) return null
  return NAME_TO_CODE[name.trim().toLowerCase()] ?? null
}

/**
 * Compact 1-2 char label for the split-button direction indicator.
 * `uiLocale` selects the script style ("中" for zh, "Zh" otherwise).
 */
export function languageShortLabel(
  code: DetectedLanguageCode,
  uiLocale: "zh" | "en" = "en",
): string {
  if (code === "unknown") return "?"
  if (uiLocale === "zh") {
    const zhMap: Record<Exclude<DetectedLanguageCode, "unknown">, string> = {
      zh: "中",
      en: "英",
      ja: "日",
      ko: "韩",
      ar: "阿",
      ru: "俄",
      fr: "法",
      de: "德",
      es: "西",
      pt: "葡",
      it: "意",
    }
    return zhMap[code]
  }
  const enMap: Record<Exclude<DetectedLanguageCode, "unknown">, string> = {
    zh: "Zh",
    en: "En",
    ja: "Ja",
    ko: "Ko",
    ar: "Ar",
    ru: "Ru",
    fr: "Fr",
    de: "De",
    es: "Es",
    pt: "Pt",
    it: "It",
  }
  return enMap[code]
}

/**
 * Pick the best target language for a one-click translate.
 *
 * Heuristic, in priority order:
 *  1. Most recent user-picked target whose language ≠ the source language
 *     (translating en→en is silly). User's explicit history wins.
 *  2. Source unknown → UI language (safest bet for the reader).
 *  3. Source ≠ UI language → UI language.
 *  4. Source == UI language → swap to the other major script (en↔zh).
 *
 * `recentTargets` is expected to be display names ordered most-recent-first.
 */
export function resolveSmartTarget(
  sourceCode: DetectedLanguageCode,
  uiTargetDisplayName: string,
  recentTargets: ReadonlyArray<string>,
): string {
  const sourceName = sourceCode !== "unknown" ? DISPLAY_NAMES[sourceCode] : null

  for (const target of recentTargets) {
    if (sourceName && target.toLowerCase() === sourceName.toLowerCase()) continue
    return target
  }

  if (!sourceName) return uiTargetDisplayName
  if (sourceName !== uiTargetDisplayName) return uiTargetDisplayName
  return uiTargetDisplayName === "English" ? "Chinese" : "English"
}
