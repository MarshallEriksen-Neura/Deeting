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
