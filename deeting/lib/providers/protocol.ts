export function inferProviderProtocol(source?: string | null): string {
  const normalized = (source || "").trim().toLowerCase()

  if (
    normalized.includes("volcengine_openspeech_tts") ||
    normalized.includes("openspeech")
  ) {
    return "volcengine_openspeech_tts"
  }
  if (normalized.includes("minimax_tts")) {
    return "minimax_tts"
  }
  if (normalized.includes("openai_tts")) {
    return "openai_tts"
  }
  if (normalized.includes("anthropic") || normalized.includes("claude")) {
    return "anthropic"
  }
  if (normalized.includes("minimax")) {
    return "minimax"
  }
  if (
    normalized.includes("volcengine") ||
    normalized.includes("bytedance") ||
    normalized.includes("sami")
  ) {
    return "volcengine"
  }

  return "openai"
}

export function resolveProviderProtocol(
  protocol?: string | null,
  ...fallbacks: Array<string | null | undefined>
): string {
  const normalizedProtocol = protocol?.trim().toLowerCase()
  if (normalizedProtocol) {
    return normalizedProtocol
  }

  for (const fallback of fallbacks) {
    const normalizedFallback = fallback?.trim()
    if (normalizedFallback) {
      return inferProviderProtocol(normalizedFallback)
    }
  }

  return "openai"
}
