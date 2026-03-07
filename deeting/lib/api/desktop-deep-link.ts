const DESKTOP_DEEP_LINK_EVENT = "deep-link://new-url"
const GET_CURRENT_DESKTOP_DEEP_LINK_COMMAND = "plugin:deep-link|get_current"

export async function getCurrentDesktopDeepLinks(): Promise<string[] | null> {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<string[] | null>(GET_CURRENT_DESKTOP_DEEP_LINK_COMMAND)
}

export async function listenForDesktopDeepLinks(
  handler: (urls: string[]) => void | Promise<void>
): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event")

  return listen<string[]>(DESKTOP_DEEP_LINK_EVENT, async (event) => {
    await handler(event.payload)
  })
}
