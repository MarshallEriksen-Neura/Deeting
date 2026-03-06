export async function getDesktopConfig(key: string): Promise<string | null> {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<string | null>("get_desktop_config", { key })
}

export async function setDesktopConfig(key: string, value: string): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke("set_desktop_config", { key, value })
}

export const DESKTOP_CONFIG_KEYS = {
  maxAgenticRounds: "max_agentic_rounds",
} as const
