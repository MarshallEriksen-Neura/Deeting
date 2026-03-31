export const RENDER_CHANNEL_UPDATE_EVENT = "deeting:render-channel:update"

export interface RenderChannelUpdate {
  channelId: string
  data: unknown
  reason?: string
  issuedAt?: number
}

export function emitRenderChannelUpdate(update: RenderChannelUpdate) {
  if (typeof window === "undefined") return
  window.dispatchEvent(
    new CustomEvent<RenderChannelUpdate>(RENDER_CHANNEL_UPDATE_EVENT, {
      detail: {
        ...update,
        issuedAt: update.issuedAt ?? Date.now(),
      },
    })
  )
}

export function subscribeRenderChannel(
  channelId: string,
  listener: (update: RenderChannelUpdate) => void
) {
  if (typeof window === "undefined") {
    return () => {}
  }

  const normalized = channelId.trim()
  if (!normalized) {
    return () => {}
  }

  const handleEvent = (event: Event) => {
    const customEvent = event as CustomEvent<RenderChannelUpdate>
    const detail = customEvent.detail
    if (!detail || typeof detail.channelId !== "string") return
    if (detail.channelId.trim() !== normalized) return
    listener(detail)
  }

  window.addEventListener(RENDER_CHANNEL_UPDATE_EVENT, handleEvent as EventListener)
  return () => {
    window.removeEventListener(RENDER_CHANNEL_UPDATE_EVENT, handleEvent as EventListener)
  }
}
