const VERSION_SEGMENT_RE = /^v\d+(?:\.\d+)?$/i

type NormalizeProviderEndpointInputArgs = {
  baseUrl: string
  protocol?: string | null
}

export type NormalizedProviderEndpoint = {
  baseUrl: string
  chatTransportPath: string | null
  hadExplicitChatPath: boolean
  protocolHint: string | null
}

function isVersionSegment(segment: string): boolean {
  return VERSION_SEGMENT_RE.test((segment || "").trim())
}

function normalizeProtocolHint(protocol?: string | null): string {
  return (protocol || "").trim().toLowerCase()
}

function inferProtocolHintFromBaseUrl(baseUrl: string, protocolHint: string): string {
  if (protocolHint) {
    return protocolHint
  }

  const normalized = (baseUrl || "").trim().toLowerCase()
  if (!normalized) {
    return ""
  }

  if (
    normalized.includes("openspeech.bytedance.com") ||
    normalized.includes("openspeech")
  ) {
    return "volcengine_openspeech_tts"
  }
  if (
    normalized.includes("minimaxi.com") &&
    normalized.includes("t2a")
  ) {
    return "minimax_tts"
  }
  if (
    normalized.includes("anthropic") ||
    normalized.includes("claude") ||
    normalized.endsWith("/v1/messages")
  ) {
    return "anthropic"
  }
  if (normalized.endsWith("/responses")) {
    return "responses"
  }
  if (
    normalized.includes("google") ||
    normalized.includes("gemini") ||
    normalized.includes("vertex")
  ) {
    return "google"
  }
  return "openai"
}

function inferDefaultChatTransportPath(protocolHint: string): string | null {
  if (
    protocolHint.includes("openspeech") ||
    protocolHint.includes("minimax_tts") ||
    protocolHint.includes("openai_tts")
  ) {
    return null
  }
  if (protocolHint.includes("anthropic") || protocolHint.includes("claude")) {
    return "v1/messages"
  }
  if (protocolHint.includes("responses")) {
    return "responses"
  }
  if (
    protocolHint.includes("google") ||
    protocolHint.includes("gemini") ||
    protocolHint.includes("vertex")
  ) {
    return null
  }
  return "chat/completions"
}

function splitKnownChatEndpoint(
  rawBaseUrl: string,
  protocolHint: string
): { baseUrl: string; chatTransportPath: string | null } {
  try {
    const parsed = new URL(rawBaseUrl)
    const segments = parsed.pathname.split("/").filter(Boolean)
    const lowered = segments.map((segment) => segment.toLowerCase())

    if (
      (protocolHint.includes("anthropic") || protocolHint.includes("claude")) &&
      lowered.length >= 2 &&
      lowered.at(-2) === "v1" &&
      lowered.at(-1) === "messages"
    ) {
      const baseSegments = segments.slice(0, -2)
      parsed.pathname = baseSegments.length ? `/${baseSegments.join("/")}` : ""
      return {
        baseUrl: parsed.toString().replace(/\/$/, ""),
        chatTransportPath: "v1/messages",
      }
    }

    if (lowered.at(-1) === "responses") {
      const baseSegments = segments.slice(0, -1)
      parsed.pathname = baseSegments.length ? `/${baseSegments.join("/")}` : ""
      return {
        baseUrl: parsed.toString().replace(/\/$/, ""),
        chatTransportPath: "responses",
      }
    }

    if (lowered.length >= 2 && lowered.at(-2) === "chat" && lowered.at(-1) === "completions") {
      const baseSegments = segments.slice(0, -2)
      parsed.pathname = baseSegments.length ? `/${baseSegments.join("/")}` : ""
      return {
        baseUrl: parsed.toString().replace(/\/$/, ""),
        chatTransportPath: "chat/completions",
      }
    }

    return { baseUrl: rawBaseUrl, chatTransportPath: null }
  } catch {
    return { baseUrl: rawBaseUrl, chatTransportPath: null }
  }
}

export function normalizeProviderEndpointInput({
  baseUrl,
  protocol,
}: NormalizeProviderEndpointInputArgs): NormalizedProviderEndpoint {
  const normalizedBaseUrl = (baseUrl || "").trim().replace(/\/+$/, "")
  if (!normalizedBaseUrl) {
    return {
      baseUrl: "",
      chatTransportPath: null,
      hadExplicitChatPath: false,
      protocolHint: null,
    }
  }

  const protocolHint = inferProtocolHintFromBaseUrl(
    normalizedBaseUrl,
    normalizeProtocolHint(protocol)
  )
  const split = splitKnownChatEndpoint(normalizedBaseUrl, protocolHint)
  const defaultChatTransportPath = inferDefaultChatTransportPath(protocolHint)

  return {
    baseUrl: split.baseUrl,
    chatTransportPath: split.chatTransportPath ?? defaultChatTransportPath,
    hadExplicitChatPath: Boolean(split.chatTransportPath),
    protocolHint: protocolHint || null,
  }
}

export function stripRedundantVersionPrefix(path: string): string {
  const segments = (path || "").split("/").filter(Boolean)
  if (segments.length === 0) {
    return ""
  }
  if (isVersionSegment(segments[0])) {
    return segments.slice(1).join("/")
  }
  if (
    segments.length >= 2 &&
    segments[0].toLowerCase() === "api" &&
    isVersionSegment(segments[1])
  ) {
    return segments.slice(2).join("/")
  }
  return segments.join("/")
}
