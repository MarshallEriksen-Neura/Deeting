import { request } from "@/lib/http"

export type DesktopOAuthProvider = "google" | "github"

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
  provider: DesktopOAuthProvider
  session_id: string
  state: string
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

const AUTH_OAUTH_BASE = "/api/v1/auth/oauth"
const DESKTOP_SCHEME = "deeting:"

export async function startDesktopOAuthSession(
  payload: DesktopOAuthStartRequest
): Promise<DesktopOAuthStartResponse> {
  return request<DesktopOAuthStartResponse>({
    url: `${AUTH_OAUTH_BASE}/desktop/start`,
    method: "POST",
    data: {
      provider: payload.provider,
      return_scheme: payload.return_scheme ?? "deeting",
      platform: payload.platform ?? "desktop",
    },
  })
}

export async function exchangeDesktopOAuthGrant(
  payload: DesktopOAuthExchangeRequest
): Promise<DesktopOAuthExchangeResponse> {
  return request<DesktopOAuthExchangeResponse>({
    url: `${AUTH_OAUTH_BASE}/desktop/exchange`,
    method: "POST",
    data: payload,
  })
}

export async function openDesktopOAuthAuthorizeUrl(url: string): Promise<void> {
  const { openUrl } = await import("@tauri-apps/plugin-opener")
  await openUrl(url)
}

export function parseDesktopOAuthCallbackUrl(url: string): DesktopOAuthExchangeRequest | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== DESKTOP_SCHEME) return null
    if (parsed.hostname !== "auth") return null
    if (parsed.pathname !== "/callback") return null

    const provider = parsed.searchParams.get("provider")?.trim()
    const sessionId = parsed.searchParams.get("session_id")?.trim()
    const state = parsed.searchParams.get("state")?.trim()
    const grant = parsed.searchParams.get("grant")?.trim()

    if (
      provider !== "google" &&
      provider !== "github"
    ) {
      return null
    }

    if (!sessionId || !state || !grant) {
      return null
    }

    return {
      provider,
      session_id: sessionId,
      state,
      grant,
    }
  } catch {
    return null
  }
}
