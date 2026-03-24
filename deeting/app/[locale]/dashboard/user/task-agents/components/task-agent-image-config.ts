export type TaskAgentImageConfigDraft = {
  negative_prompt: string
  width: string
  height: string
  aspect_ratio: string
  num_outputs: string
  steps: string
  cfg_scale: string
  seed: string
  sampler_name: string
  quality: string
  style: string
  response_format: string
  image_url: string
  extra_params_json: string
}

const EMPTY_DRAFT: TaskAgentImageConfigDraft = {
  negative_prompt: "",
  width: "",
  height: "",
  aspect_ratio: "",
  num_outputs: "",
  steps: "",
  cfg_scale: "",
  seed: "",
  sampler_name: "",
  quality: "",
  style: "",
  response_format: "",
  image_url: "",
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

export function createEmptyTaskAgentImageConfigDraft(): TaskAgentImageConfigDraft {
  return { ...EMPTY_DRAFT }
}

export function buildTaskAgentImageConfigDraft(
  modelConfig?: Record<string, unknown> | null,
): TaskAgentImageConfigDraft {
  const imageConfig = asRecord(modelConfig?.image_generation)
  if (!imageConfig) return createEmptyTaskAgentImageConfigDraft()

  return {
    negative_prompt: asString(imageConfig.negative_prompt),
    width: asNumberString(imageConfig.width),
    height: asNumberString(imageConfig.height),
    aspect_ratio: asString(imageConfig.aspect_ratio),
    num_outputs: asNumberString(imageConfig.num_outputs),
    steps: asNumberString(imageConfig.steps),
    cfg_scale: asNumberString(imageConfig.cfg_scale),
    seed: asNumberString(imageConfig.seed),
    sampler_name: asString(imageConfig.sampler_name),
    quality: asString(imageConfig.quality),
    style: asString(imageConfig.style),
    response_format: asString(imageConfig.response_format),
    image_url: asString(imageConfig.image_url),
    extra_params_json: imageConfig.extra_params
      ? JSON.stringify(imageConfig.extra_params, null, 2)
      : "",
  }
}

export function parseTaskAgentImageExtraParamsJson(raw: string): {
  value: Record<string, unknown> | null
  error: string | null
} {
  const trimmed = raw.trim()
  if (!trimmed) {
    return { value: null, error: null }
  }

  try {
    const parsed = JSON.parse(trimmed)
    const value = asRecord(parsed)
    if (!value) {
      return {
        value: null,
        error: "Image extra params JSON must be a valid object.",
      }
    }
    return { value, error: null }
  } catch {
    return {
      value: null,
      error: "Image extra params JSON must be a valid object.",
    }
  }
}

function parseInteger(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number.parseInt(trimmed, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function parseFloatNumber(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number.parseFloat(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

function assignIfPresent(
  target: Record<string, unknown>,
  key: string,
  value: string,
  parser?: (next: string) => number | null,
) {
  const trimmed = value.trim()
  if (!trimmed) return
  if (!parser) {
    target[key] = trimmed
    return
  }
  const parsed = parser(trimmed)
  if (parsed !== null) {
    target[key] = parsed
  }
}

export function applyTaskAgentImageConfigToModelConfig(
  baseModelConfig: Record<string, unknown>,
  draft: TaskAgentImageConfigDraft,
  extraParams: Record<string, unknown> | null,
): Record<string, unknown> {
  const next = { ...baseModelConfig }
  const imageGeneration: Record<string, unknown> = {}

  assignIfPresent(imageGeneration, "negative_prompt", draft.negative_prompt)
  assignIfPresent(imageGeneration, "width", draft.width, parseInteger)
  assignIfPresent(imageGeneration, "height", draft.height, parseInteger)
  assignIfPresent(imageGeneration, "aspect_ratio", draft.aspect_ratio)
  assignIfPresent(imageGeneration, "num_outputs", draft.num_outputs, parseInteger)
  assignIfPresent(imageGeneration, "steps", draft.steps, parseInteger)
  assignIfPresent(imageGeneration, "cfg_scale", draft.cfg_scale, parseFloatNumber)
  assignIfPresent(imageGeneration, "seed", draft.seed, parseInteger)
  assignIfPresent(imageGeneration, "sampler_name", draft.sampler_name)
  assignIfPresent(imageGeneration, "quality", draft.quality)
  assignIfPresent(imageGeneration, "style", draft.style)
  assignIfPresent(imageGeneration, "response_format", draft.response_format)
  if (extraParams && Object.keys(extraParams).length > 0) {
    imageGeneration.extra_params = extraParams
  }

  if (Object.keys(imageGeneration).length > 0) {
    next.image_generation = imageGeneration
  } else {
    delete next.image_generation
  }

  return next
}
