const isTauriRuntime = () =>
  process.env.NEXT_PUBLIC_IS_TAURI === "true" &&
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<T>(command, args)
}

function assertDesktopRuntime() {
  if (!isTauriRuntime()) {
    throw new Error("desktop IM settings are only available in desktop runtime")
  }
}

export type ImTransportPreference = "auto" | "direct" | "relay"
export type ImTransportKind = "direct" | "relay" | "unavailable"
export type ImTransportReasonCode =
  | "direct_supported"
  | "direct_missing_credentials"
  | "direct_probe_failed"
  | "relay_configured_fallback"
  | "relay_forced_by_user"
  | "direct_forced_by_user"
  | "relay_missing_config"
  | "no_available_transport"

export interface DesktopImDirectConfig {
  feishu_app_id: string
  feishu_app_secret: string
  telegram_bot_token: string
}

export interface DesktopImRelayConfig {
  base_url: string
  shared_secret: string
}

export interface DesktopImConnectionProfile {
  id: string
  platform: "feishu" | "telegram" | "wechat" | "dingtalk" | "qq"
  display_name: string
  enabled: boolean
  transport_preference: ImTransportPreference
  direct_config: DesktopImDirectConfig
  relay_config: DesktopImRelayConfig
}

export interface DesktopImTransportResolution {
  effective: ImTransportKind
  reason_code: ImTransportReasonCode
  user_message: string
}

export interface ResolvedDesktopImConnectionProfile {
  profile_id: string
  platform: DesktopImConnectionProfile["platform"]
  display_name: string
  enabled: boolean
  resolution: DesktopImTransportResolution
}

export interface DesktopImSettingsSnapshot {
  profiles: DesktopImConnectionProfile[]
  resolved_profiles: ResolvedDesktopImConnectionProfile[]
}

export function createDefaultFeishuProfile(): DesktopImConnectionProfile {
  return {
    id: "feishu-default",
    platform: "feishu",
    display_name: "Feishu",
    enabled: false,
    transport_preference: "auto",
    direct_config: {
      feishu_app_id: "",
      feishu_app_secret: "",
      telegram_bot_token: "",
    },
    relay_config: {
      base_url: "",
      shared_secret: "",
    },
  }
}

export function getPrimaryFeishuProfile(
  snapshot: DesktopImSettingsSnapshot | null | undefined
): DesktopImConnectionProfile {
  return (
    snapshot?.profiles.find((profile) => profile.platform === "feishu") ??
    createDefaultFeishuProfile()
  )
}

export function getPrimaryFeishuResolution(
  snapshot: DesktopImSettingsSnapshot | null | undefined
): ResolvedDesktopImConnectionProfile | null {
  return (
    snapshot?.resolved_profiles.find((profile) => profile.platform === "feishu") ??
    null
  )
}

export async function getDesktopImSettings(): Promise<DesktopImSettingsSnapshot> {
  assertDesktopRuntime()
  return invokeTauri<DesktopImSettingsSnapshot>("get_local_im_settings")
}

export async function updateDesktopImSettings(
  profiles: DesktopImConnectionProfile[]
): Promise<DesktopImSettingsSnapshot> {
  assertDesktopRuntime()
  return invokeTauri<DesktopImSettingsSnapshot>("update_local_im_settings", {
    profiles,
  })
}
