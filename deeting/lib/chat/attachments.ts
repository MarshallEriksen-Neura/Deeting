import type { ChatImageAttachment } from "@/lib/chat/message-content"

type AttachmentBuildResult = {
  attachments: ChatImageAttachment[]
  rejected: number
  skipped: number
}

const createAttachmentId = () => {
  const cryptoObj = typeof globalThis !== "undefined" ? globalThis.crypto : undefined
  if (cryptoObj?.randomUUID) {
    return cryptoObj.randomUUID()
  }
  return `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result)
      } else {
        reject(new Error("invalid_result"))
      }
    }
    reader.onerror = () => reject(new Error("read_failed"))
    reader.readAsDataURL(file)
  })

export async function buildImageAttachments(files: File[]): Promise<AttachmentBuildResult> {
  const imageFiles = files.filter((file) => file.type.startsWith("image/"))
  const skipped = files.length - imageFiles.length
  if (!imageFiles.length) {
    return { attachments: [], rejected: 0, skipped }
  }

  const results = await Promise.allSettled(
    imageFiles.map(async (file) => ({
      id: createAttachmentId(),
      url: await readFileAsDataUrl(file),
      name: file.name,
      size: file.size,
      type: file.type,
    }))
  )

  const attachments: ChatImageAttachment[] = []
  let rejected = 0
  results.forEach((result) => {
    if (result.status === "fulfilled") {
      attachments.push(result.value)
    } else {
      rejected += 1
    }
  })

  return { attachments, rejected, skipped }
}

export type { AttachmentBuildResult }

