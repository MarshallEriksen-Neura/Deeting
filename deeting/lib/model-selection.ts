// `model_name` is kept as a legacy/back-compat key in several payloads.
// Prefer provider_model_id, then modern `model`, and only then the legacy key.
export function getModelConfigReference(modelConfig?: Record<string, unknown> | null) {
  const candidates = [
    modelConfig?.provider_model_id,
    modelConfig?.model,
    modelConfig?.model_name,
  ]

  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const trimmed = candidate.trim()
      if (trimmed) return trimmed
    }
  }

  return null
}

export function hasSecretaryModelSelection(secretary?: {
  model_name?: string | null
  provider_model_id?: string | null
} | null) {
  return Boolean(
    secretary?.provider_model_id?.trim() || secretary?.model_name?.trim()
  )
}