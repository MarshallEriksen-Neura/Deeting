import type { LocalProviderPreset } from "./types"

export function derivePresetCapabilities(preset: LocalProviderPreset): string[] {
  const protocolProfiles = preset.protocol_profiles
  if (protocolProfiles && typeof protocolProfiles === "object") {
    const capabilities = Object.keys(protocolProfiles)
      .map((key) => key.trim())
      .filter((key) => key.length > 0)
    return capabilities
  }
  return []
}

export function derivePresetProtocol(preset: LocalProviderPreset): string | null {
  const protocolProfiles = preset.protocol_profiles
  if (!protocolProfiles || typeof protocolProfiles !== "object") {
    return null
  }

  const priorities = ["text_to_speech", "chat", "image_generation", "embedding"]
  for (const capability of priorities) {
    const profile = (protocolProfiles as Record<string, unknown>)[capability]
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
      continue
    }
    const metadata = (profile as Record<string, unknown>).metadata
    if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
      const protocol = (metadata as Record<string, unknown>).protocol
      if (typeof protocol === "string" && protocol.trim()) {
        return protocol.trim()
      }
    }
    const directProtocol = (profile as Record<string, unknown>).protocol
    if (typeof directProtocol === "string" && directProtocol.trim()) {
      return directProtocol.trim()
    }
  }

  return null
}
