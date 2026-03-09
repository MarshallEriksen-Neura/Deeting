export function inferProviderProtocol(source?: string | null): string {
  const normalized = (source || "").trim().toLowerCase()

  if (normalized.includes("anthropic") || normalized.includes("claude")) {
    return "anthropic"
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