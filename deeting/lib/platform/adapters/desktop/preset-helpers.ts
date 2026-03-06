import type { LocalProviderPreset } from "./types"

export function derivePresetCapabilities(preset: LocalProviderPreset): string[] {
  const capabilityConfigs = preset.capability_configs
  if (!capabilityConfigs || typeof capabilityConfigs !== "object") {
    return []
  }

  return Object.keys(capabilityConfigs)
    .map((key) => key.trim())
    .filter((key) => key.length > 0)
}
