export type TaskAgentVoiceConfigDraft = {
  voice: string
  response_format: string
  speed: string
  extra_params_json: string
}

const EMPTY_DRAFT: TaskAgentVoiceConfigDraft = {
  voice: "",
  response_format: "",
  speed: "",
  extra_params_json: "",
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function asNumberString(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value)
  }
  return ""
}

export function createEmptyTaskAgentVoiceConfigDraft(): TaskAgentVoiceConfigDraft {
  return { ...EMPTY_DRAFT }
}

export function buildTaskAgentVoiceConfigDraft(
  modelConfig?: Record<string, unknown> | null,
): TaskAgentVoiceConfigDraft {
  const ttsConfig = asRecord(modelConfig?.text_to_speech)
  if (!ttsConfig) return createEmptyTaskAgentVoiceConfigDraft()

  return {
    voice: asString(ttsConfig.voice),
    response_format: asString(ttsConfig.response_format),
    speed: asNumberString(ttsConfig.speed),
    extra_params_json: ttsConfig.extra_params
      ? JSON.stringify(ttsConfig.extra_params, null, 2)
      : "",
  }
}

export function parseTaskAgentVoiceExtraParamsJson(raw: string): {
  value: Record<string, unknown> | null
  error: string | null
} {
  const trimmed = raw.trim()
  if (!trimmed) return { value: null, error: null }

  try {
    const parsed = JSON.parse(trimmed)
    const value = asRecord(parsed)
    if (!value) {
      return {
        value: null,
        error: "Voice extra params JSON must be a valid object.",
      }
    }
    return { value, error: null }
  } catch {
    return {
      value: null,
      error: "Voice extra params JSON must be a valid object.",
    }
  }
}

function parseFloatNumber(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number.parseFloat(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

export function applyTaskAgentVoiceConfigToModelConfig(
  baseModelConfig: Record<string, unknown>,
  draft: TaskAgentVoiceConfigDraft,
  extraParams: Record<string, unknown> | null,
): Record<string, unknown> {
  const next = { ...baseModelConfig }
  const textToSpeech: Record<string, unknown> = {}

  if (draft.voice.trim()) {
    textToSpeech.voice = draft.voice.trim()
  }
  if (draft.response_format.trim()) {
    textToSpeech.response_format = draft.response_format.trim()
  }
  const speed = parseFloatNumber(draft.speed)
  if (speed !== null) {
    textToSpeech.speed = speed
  }
  if (extraParams && Object.keys(extraParams).length > 0) {
    textToSpeech.extra_params = extraParams
  }

  if (Object.keys(textToSpeech).length > 0) {
    next.text_to_speech = textToSpeech
  } else {
    delete next.text_to_speech
  }

  return next
}
