export const MODEL_CONFIG_REQUIRED_PREFIX = "MODEL_CONFIG_REQUIRED"
export const MODEL_CONFIG_REQUIRED_EVENT = "deeting:model-config-required"

export type MissingDesktopModelConfig = "secretary" | "embedding" | "multimodal"

export interface ModelConfigRequiredDetail {
  missing: MissingDesktopModelConfig[]
}

function extractErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error
  }
  if (error instanceof Error) {
    return error.message
  }
  if (error && typeof error === "object") {
    const maybeMessage = (error as { message?: unknown }).message
    if (typeof maybeMessage === "string") {
      return maybeMessage
    }
  }
  return ""
}

function normalizeMissingConfigs(raw: string): MissingDesktopModelConfig[] {
  const items = raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)

  const normalized: MissingDesktopModelConfig[] = []
  for (const item of items) {
    if (item === "secretary" || item === "embedding" || item === "multimodal") {
      normalized.push(item)
    }
  }
  return Array.from(new Set(normalized))
}

export function parseModelConfigRequiredError(
  error: unknown
): ModelConfigRequiredDetail | null {
  const message = extractErrorMessage(error)
  const marker = `${MODEL_CONFIG_REQUIRED_PREFIX}::`
  const markerIndex = message.indexOf(marker)
  if (markerIndex < 0) {
    return null
  }

  const tail = message.slice(markerIndex + marker.length)
  const missingSegment = tail.split("::")[0]?.trim() ?? ""
  const missing = normalizeMissingConfigs(missingSegment)
  if (missing.length === 0) {
    return null
  }

  return { missing }
}

export function emitModelConfigRequired(detail: ModelConfigRequiredDetail): void {
  if (typeof window === "undefined") {
    return
  }
  window.dispatchEvent(
    new CustomEvent<ModelConfigRequiredDetail>(MODEL_CONFIG_REQUIRED_EVENT, {
      detail,
    })
  )
}

export function handleModelConfigRequiredError(error: unknown): boolean {
  const detail = parseModelConfigRequiredError(error)
  if (!detail) {
    return false
  }
  emitModelConfigRequired(detail)
  return true
}
