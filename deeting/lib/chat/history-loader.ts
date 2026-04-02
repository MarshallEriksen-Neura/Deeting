import {
  fetchConversationHistory,
  type ConversationHistoryResponse,
} from "@/lib/api/conversations"
import { prepareDesktopObjectStorageRead } from "@/lib/api/desktop-object-storage"
import { signAssets } from "@/lib/api/media-assets"
import { normalizeConversationMessages } from "@/lib/chat/conversation-adapter"
import type { Message } from "@/lib/chat/message-types"

async function resolveLocalChatAsset(
  sha256: string,
  contentType: string
): Promise<string | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core")
    const result = await invoke<{ data_url: string }>("read_local_chat_asset", {
      payload: { sha256, content_type: contentType },
    })
    return result.data_url
  } catch {
    return null
  }
}

async function resolveDesktopObjectStorageAssetUrls(objectKeys: string[]) {
  if (!objectKeys.length) {
    return new Map<string, string>()
  }

  const settled = await Promise.allSettled(
    objectKeys.map(async (objectKey) => {
      const ticket = await prepareDesktopObjectStorageRead({
        object_key: objectKey,
        expires_seconds: 900,
      })
      return [objectKey, ticket.asset_url] as const
    })
  )

  const urlMap = new Map<string, string>()
  const unresolved: string[] = []
  settled.forEach((result, index) => {
    const objectKey = objectKeys[index]
    if (result.status === "fulfilled") {
      urlMap.set(result.value[0], result.value[1])
      return
    }
    unresolved.push(objectKey)
  })

  if (unresolved.length) {
    const signedResult = await signAssets(unresolved).catch(() => ({
      assets: [] as { object_key: string; asset_url: string }[],
    }))
    signedResult.assets.forEach((item) => {
      urlMap.set(item.object_key, item.asset_url)
    })
  }

  return urlMap
}

export async function resolveMessageAttachments(messages: Message[], isTauri = false) {
  const objectKeys = new Set<string>()
  const localAssets: { msgIdx: number; attIdx: number; sha256: string; type: string }[] = []

  messages.forEach((message, msgIdx) => {
    message.attachments?.forEach((attachment, attIdx) => {
      if (
        isTauri &&
        attachment.source === "local" &&
        attachment.sha256 &&
        (!attachment.url || attachment.url.startsWith("local-asset://"))
      ) {
        localAssets.push({
          msgIdx,
          attIdx,
          sha256: attachment.sha256,
          type: attachment.type || "image/png",
        })
        return
      }
      const key = attachment.objectKey
      if (!key) return
      if (!attachment.url || attachment.url.startsWith("asset://")) {
        objectKeys.add(key)
      }
    })
  })

  if (!objectKeys.size && !localAssets.length) return messages

  const [urlMap, ...localResults] = await Promise.all([
    objectKeys.size
      ? isTauri
        ? resolveDesktopObjectStorageAssetUrls(Array.from(objectKeys))
        : signAssets(Array.from(objectKeys))
            .then(
              (result) => new Map(result.assets.map((item) => [item.object_key, item.asset_url]))
            )
            .catch(() => new Map<string, string>())
      : Promise.resolve(new Map<string, string>()),
    ...localAssets.map((la) => resolveLocalChatAsset(la.sha256, la.type)),
  ])

  const localUrlMap = new Map<string, string>()
  localAssets.forEach((la, i) => {
    const dataUrl = localResults[i]
    if (dataUrl) localUrlMap.set(la.sha256, dataUrl)
  })

  return messages.map((message) => {
    if (!message.attachments?.length) return message
    const attachments = message.attachments.map((attachment) => {
      if (attachment.source === "local" && attachment.sha256 && localUrlMap.has(attachment.sha256)) {
        return { ...attachment, url: localUrlMap.get(attachment.sha256)! }
      }
      if (!attachment.objectKey) return attachment
      const url = urlMap.get(attachment.objectKey)
      if (!url) return attachment
      return { ...attachment, url }
    })
    return { ...message, attachments }
  })
}

export type LoadedConversationHistoryPage = {
  messages: Message[]
  nextCursor: number | null
  hasMore: boolean
  raw: ConversationHistoryResponse
}

export async function loadConversationHistoryPage(
  sessionId: string,
  options: {
    cursor?: number
    limit?: number
    idPrefix?: string
    isTauriRuntime?: boolean
    onAttachmentResolutionError?: (error: unknown) => void
  } = {}
): Promise<LoadedConversationHistoryPage> {
  const response = await fetchConversationHistory(sessionId, {
    cursor: options.cursor,
    limit: options.limit ?? 30,
  })
  const mapped = normalizeConversationMessages(response.messages ?? [], {
    idPrefix: options.idPrefix ?? sessionId,
  })

  let messages = mapped
  try {
    messages = await resolveMessageAttachments(mapped, options.isTauriRuntime === true)
  } catch (error) {
    console.warn("resolve_attachments_failed", error)
    options.onAttachmentResolutionError?.(error)
  }

  return {
    messages,
    nextCursor: response.next_cursor ?? null,
    hasMore: Boolean(response.has_more),
    raw: response,
  }
}
