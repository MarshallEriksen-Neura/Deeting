export type ChatContentBlock =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } | string }
  | {
      type: "input_file"
      input_file?: { file_id?: string; filename?: string } | string
      file_id?: string
      filename?: string
    }

export type ChatMessageContent = string | ChatContentBlock[]

export type ChatAttachment = {
  id: string
  kind?: "image" | "file"
  url?: string
  objectKey?: string
  fileId?: string
  source?: "oss" | "local" | "data" | "model"
  name?: string
  size?: number
  type?: string
  width?: number
  height?: number
  sha256?: string
}

// 兼容旧命名，避免影响现有调用方
export type ChatImageAttachment = ChatAttachment

const isContentBlock = (value: unknown): value is ChatContentBlock => {
  if (!value || typeof value !== "object") return false
  return "type" in value
}

const isContentBlockArray = (value: unknown): value is ChatContentBlock[] =>
  Array.isArray(value) && value.every(isContentBlock)

const parseImageUrl = (
  value: unknown
): { url?: string; objectKey?: string; localSha256?: string } | null => {
  let url: string | null = null
  if (typeof value === "string") {
    url = value
  } else if (value && typeof value === "object" && "url" in value) {
    const raw = (value as { url?: unknown }).url
    if (typeof raw === "string") {
      url = raw
    }
  }
  if (!url) return null
  const trimmed = url.trim()
  if (trimmed.startsWith("local-asset://")) {
    const sha256 = trimmed.slice("local-asset://".length).replace(/^\/+/, "")
    return sha256 ? { localSha256: sha256 } : null
  }
  if (trimmed.startsWith("asset://")) {
    const objectKey = trimmed.slice("asset://".length).replace(/^\/+/, "")
    return objectKey ? { objectKey } : null
  }
  return { url: trimmed }
}

const parseInputFile = (
  value: unknown
): { fileId: string; filename?: string } | null => {
  if (typeof value === "string") {
    const trimmed = value.trim()
    return trimmed ? { fileId: trimmed } : null
  }
  if (!value || typeof value !== "object") return null
  const candidate = value as { file_id?: unknown; filename?: unknown }
  const rawFileId = candidate.file_id
  if (typeof rawFileId !== "string" || !rawFileId.trim()) return null
  const filename =
    typeof candidate.filename === "string" && candidate.filename.trim()
      ? candidate.filename.trim()
      : undefined
  return { fileId: rawFileId.trim(), filename }
}

const parseInputFileFromBlock = (
  block: Extract<ChatContentBlock, { type: "input_file" }>
): { fileId: string; filename?: string } | null => {
  const nested = parseInputFile(block.input_file)
  if (nested) return nested
  const direct = parseInputFile({
    file_id: block.file_id,
    filename: block.filename,
  })
  if (direct) return direct
  return null
}

type BuildContentOptions = {
  preferResolvedUrls?: boolean
}

const buildContentUrl = (
  attachment: ChatAttachment,
  options: BuildContentOptions = {}
): string | null => {
  if (
    options.preferResolvedUrls &&
    attachment.url &&
    !attachment.url.startsWith("local-asset://") &&
    !attachment.url.startsWith("asset://")
  ) {
    return attachment.url
  }
  if (attachment.source === "local" && attachment.sha256) {
    return `local-asset://${attachment.sha256}`
  }
  if (attachment.objectKey) {
    return `asset://${attachment.objectKey}`
  }
  if (attachment.url) return attachment.url
  return null
}

const isFileAttachment = (attachment: ChatAttachment) => {
  if (attachment.kind === "file") return true
  return typeof attachment.fileId === "string" && attachment.fileId.trim().length > 0
}

export function buildContentBlocks(
  text: string,
  attachments: ChatAttachment[],
  options: BuildContentOptions = {}
): ChatContentBlock[] {
  const blocks: ChatContentBlock[] = []
  if (text.trim()) {
    blocks.push({ type: "text", text })
  }
  attachments.forEach((attachment) => {
    if (isFileAttachment(attachment)) {
      const fileId = attachment.fileId?.trim()
      if (!fileId) return
      blocks.push({
        type: "input_file",
        input_file: attachment.name
          ? { file_id: fileId, filename: attachment.name }
          : { file_id: fileId },
      })
      return
    }
    const url = buildContentUrl(attachment, options)
    if (!url) return
    blocks.push({
      type: "image_url",
      image_url: { url },
    })
  })
  return blocks
}

export function buildMessageContent(
  text: string,
  attachments: ChatAttachment[],
  options: BuildContentOptions = {}
): ChatMessageContent {
  if (!attachments.length) {
    return text
  }
  return buildContentBlocks(text, attachments, options)
}

function parseBlocks(blocks: ChatContentBlock[]) {
  const attachments: ChatAttachment[] = []
  const textParts: string[] = []

  blocks.forEach((block, index) => {
    if (block.type === "text") {
      if (typeof block.text === "string" && block.text.trim()) {
        textParts.push(block.text)
      }
      return
    }

    if (block.type === "image_url") {
      const imageInfo = parseImageUrl(block.image_url)
      if (!imageInfo) return
      if (imageInfo.localSha256) {
        attachments.push({
          id: `image-${index + 1}`,
          kind: "image",
          sha256: imageInfo.localSha256,
          source: "local",
        })
      } else {
        attachments.push({
          id: `image-${index + 1}`,
          kind: "image",
          url: imageInfo.url,
          objectKey: imageInfo.objectKey,
        })
      }
      return
    }

    if (block.type === "input_file") {
      const fileInfo = parseInputFileFromBlock(block)
      if (!fileInfo) return
      attachments.push({
        id: `file-${index + 1}`,
        kind: "file",
        fileId: fileInfo.fileId,
        name: fileInfo.filename,
        source: "model",
      })
    }
  })

  return {
    text: textParts.join("\n"),
    attachments,
  }
}

function tryParseContentString(content: string): ChatContentBlock[] | null {
  const trimmed = content.trim()
  if (!trimmed.startsWith("[")) return null
  try {
    const parsed = JSON.parse(trimmed)
    if (isContentBlockArray(parsed)) {
      return parsed
    }
    return null
  } catch {
    return null
  }
}

export function parseMessageContent(content: unknown): {
  text: string
  attachments: ChatAttachment[]
} {
  if (typeof content === "string") {
    const parsedBlocks = tryParseContentString(content)
    if (parsedBlocks) {
      return parseBlocks(parsedBlocks)
    }
    return { text: content, attachments: [] }
  }

  if (isContentBlockArray(content)) {
    return parseBlocks(content)
  }

  if (Array.isArray(content)) {
    const safeBlocks = content.filter(isContentBlock)
    if (safeBlocks.length) {
      return parseBlocks(safeBlocks)
    }
  }

  if (content == null) {
    return { text: "", attachments: [] }
  }

  return { text: String(content), attachments: [] }
}

export function serializeMessageContent(
  text: string,
  attachments: ChatAttachment[]
): string {
  if (!attachments.length) {
    return text
  }
  return JSON.stringify(buildContentBlocks(text, attachments))
}

const LOCAL_ASSET_PREFIX = "local-asset://"

export function resolveLocalAssetUrlsInContent(
  content: ChatMessageContent,
  urlMap: Map<string, string>
): ChatMessageContent {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return content
  return content.map((block) => {
    if (block.type !== "image_url") return block
    const imageUrl = block.image_url
    let url: string | undefined
    if (typeof imageUrl === "string") {
      url = imageUrl
    } else if (imageUrl && typeof imageUrl === "object" && "url" in imageUrl) {
      url = imageUrl.url
    }
    if (!url?.startsWith(LOCAL_ASSET_PREFIX)) return block
    const sha256 = url.slice(LOCAL_ASSET_PREFIX.length).replace(/^\/+/, "")
    const resolved = urlMap.get(sha256)
    if (!resolved) return block
    return {
      ...block,
      image_url: typeof imageUrl === "string" ? resolved : { ...imageUrl, url: resolved },
    }
  })
}
