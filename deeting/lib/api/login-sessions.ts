import { request } from "@/lib/http"

const BASE = "/api/v1/login-sessions"

export interface LoginSessionItem {
  id: string
  ip_address: string | null
  device_type: string | null
  device_name: string | null
  last_active_at: string
  created_at: string
  is_current: boolean
}

export async function fetchLoginSessions(): Promise<LoginSessionItem[]> {
  return request<LoginSessionItem[]>({ url: BASE })
}

export async function revokeLoginSession(sessionId: string): Promise<void> {
  await request({ url: `${BASE}/${sessionId}`, method: "DELETE" })
}
