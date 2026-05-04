export type IslandSelectionActionKind =
  | "translate"
  | "explain"
  | "summarize"
  | "ask"
  | "search"
  | "copy"

export type IslandSelectionSource =
  | "accessibility"
  | "clipboard_fallback"
  | "unavailable"

export interface IslandSelectionCapturedPayload {
  selectionId: string
  text: string
  source: IslandSelectionSource
  capturedAt: number
  charCount: number
  truncated: boolean
}

export interface IslandSelectionContext {
  selectionId: string
  text: string
  preview: string
  source: IslandSelectionSource
  capturedAt: number
  charCount: number
  truncated: boolean
  activeAction: IslandSelectionActionKind | null
}

const SELECTION_PREVIEW_MAX_CHARS = 500

export function buildSelectionPreview(text: string) {
  const trimmed = text.trim()
  if (trimmed.length <= SELECTION_PREVIEW_MAX_CHARS) return trimmed
  return `${trimmed.slice(0, SELECTION_PREVIEW_MAX_CHARS - 1).trimEnd()}…`
}

export function toIslandSelectionContext(
  payload: IslandSelectionCapturedPayload,
): IslandSelectionContext {
  return {
    selectionId: payload.selectionId,
    text: payload.text,
    preview: buildSelectionPreview(payload.text),
    source: payload.source,
    capturedAt: payload.capturedAt,
    charCount: payload.charCount,
    truncated: payload.truncated,
    activeAction: null,
  }
}
