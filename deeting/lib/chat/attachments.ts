import type { ChatImageAttachment } from "@/lib/chat/message-content"
import { completeAssetUpload, initAssetUpload } from "@/lib/api/media-assets"

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

const bufferToHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")

const hashFile = async (file: File) => {
  const data = await file.arrayBuffer()
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data)
  return bufferToHex(digest)
}

const buildUploadHeaders = (
  uploadHeaders: Record<string, string> | null | undefined,
  contentType: string
) => {
  const headers = new Headers(uploadHeaders ?? {})
  if (contentType && !headers.has("Content-Type")) {
    headers.set("Content-Type", contentType)
  }
  return headers
}

const uploadFile = async (url: string, headers: Headers, file: File) => {
  const response = await fetch(url, {
    method: "PUT",
    headers,
    body: file,
  })
  if (!response.ok) {
    throw new Error("upload_failed")
  }
}

const buildImageAttachment = async (file: File): Promise<ChatImageAttachment> => {
  const contentHash = await hashFile(file)
  const init = await initAssetUpload({
    content_hash: contentHash,
    size_bytes: file.size,
    content_type: file.type,
  })

  let assetUrl = init.asset_url ?? undefined
  if (!init.deduped) {
    if (!init.upload_url) {
      throw new Error("missing_upload_url")
    }
    const headers = buildUploadHeaders(init.upload_headers, file.type)
    await uploadFile(init.upload_url, headers, file)
    const completed = await completeAssetUpload({
      object_key: init.object_key,
      content_hash: contentHash,
      size_bytes: file.size,
      content_type: file.type,
    })
    assetUrl = completed.asset_url
  }

  if (!assetUrl) {
    throw new Error("missing_asset_url")
  }

  return {
    id: createAttachmentId(),
    url: assetUrl,
    objectKey: init.object_key,
    name: file.name,
    size: file.size,
    type: file.type,
    source: "oss",
    sha256: contentHash,
  }
}

export async function buildImageAttachments(
  files: File[]
): Promise<AttachmentBuildResult> {
  const imageFiles = files.filter((file) => file.type.startsWith("image/"))
  const skipped = files.length - imageFiles.length
  if (!imageFiles.length) {
    return { attachments: [], rejected: 0, skipped }
  }

  const results = await Promise.allSettled(
    imageFiles.map(async (file) => buildImageAttachment(file))
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
