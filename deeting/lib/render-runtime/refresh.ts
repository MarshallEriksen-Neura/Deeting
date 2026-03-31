import type { HtmlRuntimeRefreshSpec } from "@/lib/chat/message-protocol"

export const RENDER_REFRESH_REQUEST_EVENT = "deeting:render-refresh:request"

export interface RenderRefreshRequest {
  refreshSpec: HtmlRuntimeRefreshSpec
  messageId?: string
  templateId?: string
  renderHint?: string
  issuedAt?: number
}

export function emitRenderRefreshRequest(request: RenderRefreshRequest) {
  if (typeof window === "undefined") return
  window.dispatchEvent(
    new CustomEvent<RenderRefreshRequest>(RENDER_REFRESH_REQUEST_EVENT, {
      detail: {
        ...request,
        issuedAt: request.issuedAt ?? Date.now(),
      },
    })
  )
}

export function subscribeRenderRefreshRequests(
  listener: (request: RenderRefreshRequest) => void
) {
  if (typeof window === "undefined") {
    return () => {}
  }

  const handleEvent = (event: Event) => {
    const customEvent = event as CustomEvent<RenderRefreshRequest>
    const detail = customEvent.detail
    if (!detail?.refreshSpec || typeof detail.refreshSpec.kind !== "string") return
    listener(detail)
  }

  window.addEventListener(RENDER_REFRESH_REQUEST_EVENT, handleEvent as EventListener)
  return () => {
    window.removeEventListener(RENDER_REFRESH_REQUEST_EVENT, handleEvent as EventListener)
  }
}
