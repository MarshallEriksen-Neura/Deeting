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
    throw new Error("desktop relay settings are only available in desktop runtime")
  }
}

export interface DesktopRelaySettings {
  relayBaseUrl: string
  relaySharedSecret: string
}

export async function getDesktopRelaySettings(): Promise<DesktopRelaySettings> {
  assertDesktopRuntime()

  const [baseUrl, sharedSecret] = await Promise.all([
    invokeTauri<string | null>("get_desktop_config_value", { key: "relay.base_url" }),
    invokeTauri<string | null>("get_desktop_config_value", { key: "relay.shared_secret" }),
  ])

  return {
    relayBaseUrl: baseUrl ?? "",
    relaySharedSecret: sharedSecret ?? "",
  }
}

export async function updateDesktopRelaySettings(
  settings: DesktopRelaySettings
): Promise<void> {
  assertDesktopRuntime()

  await Promise.all([
    invokeTauri<void>("set_desktop_config_value", {
      key: "relay.base_url",
      value: settings.relayBaseUrl.trim(),
    }),
    invokeTauri<void>("set_desktop_config_value", {
      key: "relay.shared_secret",
      value: settings.relaySharedSecret.trim(),
    }),
  ])
}

