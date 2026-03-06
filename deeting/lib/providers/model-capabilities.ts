const CAPABILITY_ALIAS_TO_CANONICAL: Record<string, string> = {
  chat: "chat",
  chat_completion: "chat",
  chat_completions: "chat",
  text_generation: "chat",
  text: "chat",
  reasoning: "chat",
  code: "chat",
  vision: "chat",
  embedding: "embedding",
  embeddings: "embedding",
  vector: "embedding",
  image_generation: "image_generation",
  image: "image_generation",
  image_gen: "image_generation",
  text_to_image: "image_generation",
  text_to_speech: "text_to_speech",
  tts: "text_to_speech",
  speech: "text_to_speech",
  speech_to_text: "speech_to_text",
  stt: "speech_to_text",
  audio: "speech_to_text",
  audio_to_text: "speech_to_text",
  transcription: "speech_to_text",
  video_generation: "video_generation",
  video: "video_generation",
  video_gen: "video_generation",
  text_to_video: "video_generation",
  t2v: "video_generation",
}

function normalizeToken(value: unknown): string {
  if (value == null) return ""
  return String(value).trim().toLowerCase().replace(/[- ]/g, "_")
}

export function normalizeCapability(value: unknown): string | null {
  const token = normalizeToken(value)
  if (!token) return null
  return CAPABILITY_ALIAS_TO_CANONICAL[token] || token
}

export function normalizeCapabilities(values: unknown, defaultCapability?: string): string[] {
  const normalized: string[] = []
  const rawValues = Array.isArray(values) ? values : []
  for (const value of rawValues) {
    const canonical = normalizeCapability(value)
    if (canonical && !normalized.includes(canonical)) {
      normalized.push(canonical)
    }
  }
  if (normalized.length > 0) return normalized
  const fallback = normalizeCapability(defaultCapability)
  return fallback ? [fallback] : []
}

export function expandCapability(value: unknown): string[] {
  const canonical = normalizeCapability(value)
  if (!canonical) return []

  const expanded = new Set<string>([canonical, canonical.replace(/_/g, "-")])
  for (const [alias, target] of Object.entries(CAPABILITY_ALIAS_TO_CANONICAL)) {
    if (target !== canonical || alias === canonical) continue
    expanded.add(alias)
    expanded.add(alias.replace(/_/g, "-"))
  }

  const raw = String(value).trim().toLowerCase()
  if (raw) expanded.add(raw)
  return Array.from(expanded)
}

export function resolveModelCapabilities(input: {
  capabilities?: unknown
  routingConfig?: Record<string, unknown> | null
  extraMeta?: Record<string, unknown> | null
  defaultCapability?: string
}): string[] {
  const routingCapabilities = Array.isArray(input.routingConfig?.capabilities)
    ? input.routingConfig?.capabilities
    : []
  const upstreamCapabilities = Array.isArray(input.extraMeta?.upstream_capabilities)
    ? input.extraMeta?.upstream_capabilities
    : []

  return normalizeCapabilities(
    [
      ...(Array.isArray(input.capabilities) ? input.capabilities : []),
      ...routingCapabilities,
      ...upstreamCapabilities,
    ],
    input.defaultCapability
  )
}

export function modelSupportsCapability(input: {
  capabilities?: unknown
  routingConfig?: Record<string, unknown> | null
  extraMeta?: Record<string, unknown> | null
  capability?: string
}): boolean {
  const target = input.capability?.trim()
  if (!target) return true

  const candidates = new Set<string>()
  for (const capability of resolveModelCapabilities({
    capabilities: input.capabilities,
    routingConfig: input.routingConfig,
    extraMeta: input.extraMeta,
  })) {
    for (const alias of expandCapability(capability)) {
      candidates.add(alias)
    }
  }

  return expandCapability(target).some((alias) => candidates.has(alias))
}
