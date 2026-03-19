export type DesktopOAuthProvider = "google" | "github"
export type DesktopAuthGrantProvider = DesktopOAuthProvider | "browser"
export type DesktopOAuthIntent = "login" | "bind"

export interface DesktopOAuthStartRequest {
  provider: DesktopOAuthProvider
  return_scheme?: string
  platform?: string
}

export interface DesktopOAuthStartResponse {
  session_id: string
  authorize_url: string
  expires_in: number
}

export interface DesktopOAuthExchangeRequest {
  provider: DesktopAuthGrantProvider
  session_id: string
  state: string
  grant: string
}

export interface DesktopOAuthCallbackPayload {
  intent: DesktopOAuthIntent
  provider: DesktopAuthGrantProvider
  session_id: string
  state?: string
  grant: string
}

export interface DesktopOAuthExchangeResponse {
  access_token: string
  refresh_token?: string
  token_type: "bearer"
  user: {
    id: string
    email: string
    name?: string | null
  }
}

const DESKTOP_SCHEME = "deeting:"

export async function openDesktopOAuthAuthorizeUrl(url: string): Promise<void> {
  const { openUrl } = await import("@tauri-apps/plugin-opener")
  await openUrl(url)
}

export function parseDesktopOAuthCallbackUrl(url: string): DesktopOAuthCallbackPayload | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== DESKTOP_SCHEME) return null
    if (parsed.hostname !== "auth") return null
    if (parsed.pathname !== "/callback") return null

    const provider = parsed.searchParams.get("provider")?.trim()
    const intent = parsed.searchParams.get("intent")?.trim() ?? "login"
    const sessionId = parsed.searchParams.get("session_id")?.trim()
    const state = parsed.searchParams.get("state")?.trim()
    const grant = parsed.searchParams.get("grant")?.trim()

    if (provider !== "google" && provider !== "github" && provider !== "browser") {
      return null
    }

    if (!sessionId || !grant) {
      return null
    }

    if (provider !== "browser" && !state) {
      return null
    }

    if (intent !== "login" && intent !== "bind") {
      return null
    }

    return {
      intent,
      provider,
      session_id: sessionId,
      state: state ?? undefined,
      grant,
    }
  } catch {
    return null
  }
}
