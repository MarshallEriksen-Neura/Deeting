import type { HtmlRuntimeRefreshSpec } from "@/lib/chat/message-protocol"

const PENDING_RENDER_REFRESH_KEY = "deeting:render-refresh:pending"

export interface PendingRenderRefreshRequest {
  refreshSpec: HtmlRuntimeRefreshSpec
  sessionId?: string
  issuedAt: number
}

export function persistPendingRenderRefreshRequest(
  request: Omit<PendingRenderRefreshRequest, "issuedAt">
) {
  if (typeof window === "undefined") return
  sessionStorage.setItem(
    PENDING_RENDER_REFRESH_KEY,
    JSON.stringify({
      ...request,
      issuedAt: Date.now(),
    } satisfies PendingRenderRefreshRequest)
  )
}

export function readPendingRenderRefreshRequest(): PendingRenderRefreshRequest | null {
  if (typeof window === "undefined") return null
  const raw = sessionStorage.getItem(PENDING_RENDER_REFRESH_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as PendingRenderRefreshRequest
    if (!parsed?.refreshSpec || typeof parsed.refreshSpec.kind !== "string") return null
    return parsed
  } catch {
    return null
  }
}

export function clearPendingRenderRefreshRequest() {
  if (typeof window === "undefined") return
  sessionStorage.removeItem(PENDING_RENDER_REFRESH_KEY)
}
