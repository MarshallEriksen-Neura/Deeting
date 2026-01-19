export type ChatContentBlock =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } | string }

export type ChatMessageContent = string | ChatContentBlock[]

export type ChatImageAttachment = {
  id: string
  url: string
  name?: string
  size?: number
  type?: string
  width?: number
  height?: number
}

const isContentBlock = (value: unknown): value is ChatContentBlock => {
  if (!value || typeof value !== "object") return false
  return "type" in value
}

const isContentBlockArray = (value: unknown): value is ChatContentBlock[] =>
  Array.isArray(value) && value.every(isContentBlock)

const parseImageUrl = (value: unknown): string | null => {
  if (typeof value === "string") return value
  if (value && typeof value === "object" && "url" in value) {
    const url = (value as { url?: unknown }).url
    return typeof url === "string" ? url : null
  }
  return null
}

export function buildContentBlocks(
  text: string,
  attachments: ChatImageAttachment[]
): ChatContentBlock[] {
  const blocks: ChatContentBlock[] = []
  if (text.trim()) {
    blocks.push({ type: "text", text })
  }
  attachments.forEach((attachment) => {
    blocks.push({
      type: "image_url",
      image_url: { url: attachment.url },
    })
  })
  return blocks
}

export function buildMessageContent(
  text: string,
  attachments: ChatImageAttachment[]
): ChatMessageContent {
  if (!attachments.length) {
    return text
  }
  return buildContentBlocks(text, attachments)
}

function parseBlocks(blocks: ChatContentBlock[]) {
  const attachments: ChatImageAttachment[] = []
  const textParts: string[] = []

  blocks.forEach((block, index) => {
    if (block.type === "text") {
      if (typeof block.text === "string" && block.text.trim()) {
        textParts.push(block.text)
      }
      return
    }

    if (block.type === "image_url") {
      const url = parseImageUrl(block.image_url)
      if (!url) return
      attachments.push({
        id: `image-${index + 1}`,
        url,
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
  attachments: ChatImageAttachment[]
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
  attachments: ChatImageAttachment[]
): string {
  if (!attachments.length) {
    return text
  }
  return JSON.stringify(buildContentBlocks(text, attachments))
}

