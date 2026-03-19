import { request } from "@/lib/http"
import { openDesktopOAuthAuthorizeUrl } from "@/lib/api/auth-oauth-desktop"
import type { DesktopOAuthExchangeResponse } from "@/lib/api/auth-oauth-desktop"

export interface DesktopBrowserLoginStartRequest {
  return_scheme?: string
  platform?: string
}

export interface DesktopBrowserLoginStartResponse {
  session_id: string
  expires_in: number
}

export interface DesktopBrowserLoginCompleteRequest {
  session_id: string
}

export interface DesktopBrowserLoginCompleteResponse {
  deep_link_url: string
}

export interface DesktopBrowserLoginExchangeRequest {
  session_id: string
  grant: string
}

const DESKTOP_BROWSER_LOGIN_BASE = "/api/v1/auth/desktop/browser"

export async function startDesktopBrowserLoginSession(
  payload: DesktopBrowserLoginStartRequest = {}
): Promise<DesktopBrowserLoginStartResponse> {
  return request<DesktopBrowserLoginStartResponse>({
    url: `${DESKTOP_BROWSER_LOGIN_BASE}/start`,
    method: "POST",
    data: {
      return_scheme: payload.return_scheme ?? "deeting",
      platform: payload.platform ?? "desktop",
    },
    anonymous: true,
    skipAuthRefresh: true,
  })
}

export async function completeDesktopBrowserLoginSession(
  payload: DesktopBrowserLoginCompleteRequest
): Promise<DesktopBrowserLoginCompleteResponse> {
  return request<DesktopBrowserLoginCompleteResponse>({
    url: `${DESKTOP_BROWSER_LOGIN_BASE}/complete`,
    method: "POST",
    data: payload,
  })
}

export async function exchangeDesktopBrowserLoginGrant(
  payload: DesktopBrowserLoginExchangeRequest
): Promise<DesktopOAuthExchangeResponse> {
  return request<DesktopOAuthExchangeResponse>({
    url: `${DESKTOP_BROWSER_LOGIN_BASE}/exchange`,
    method: "POST",
    data: payload,
  })
}

export function buildDesktopBrowserLoginUrl(loginUrl: string, sessionId: string): string {
  const target = new URL(loginUrl)
  target.searchParams.set("desktop_login_session", sessionId)
  return target.toString()
}

export async function openDesktopBrowserLoginUrl(loginUrl: string): Promise<void> {
  await openDesktopOAuthAuthorizeUrl(loginUrl)
}
