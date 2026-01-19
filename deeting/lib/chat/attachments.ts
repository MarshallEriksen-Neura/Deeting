import type { ChatImageAttachment } from "@/lib/chat/message-content"
import { completeAssetUpload, initAssetUpload } from "@/lib/api/media-assets"

type AttachmentBuildResult = {
  attachments: ChatImageAttachment[]
  rejected: number
  skipped: number
  errors: string[]
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

const UPLOAD_ERROR_CODES = new Set([
  "hash_failed",
  "upload_init_failed",
  "upload_put_failed",
  "upload_complete_failed",
  "missing_upload_url",
  "missing_asset_url",
])

const uploadFile = async (url: string, headers: Headers, file: File) => {
  const response = await fetch(url, {
    method: "PUT",
    headers,
    body: file,
  })
  if (!response.ok) {
    throw new Error("upload_put_failed")
  }
}

const buildImageAttachment = async (file: File): Promise<ChatImageAttachment> => {
  let contentHash: string
  try {
    contentHash = await hashFile(file)
  } catch {
    throw new Error("hash_failed")
  }

  let init: Awaited<ReturnType<typeof initAssetUpload>>
  try {
    init = await initAssetUpload({
      content_hash: contentHash,
      size_bytes: file.size,
      content_type: file.type,
    })
  } catch {
    throw new Error("upload_init_failed")
  }

  let assetUrl = init.asset_url ?? undefined
  if (!init.deduped) {
    if (!init.upload_url) {
      throw new Error("missing_upload_url")
    }
    const headers = buildUploadHeaders(init.upload_headers, file.type)
    try {
      await uploadFile(init.upload_url, headers, file)
    } catch {
      throw new Error("upload_put_failed")
    }

    let completed: Awaited<ReturnType<typeof completeAssetUpload>>
    try {
      completed = await completeAssetUpload({
        object_key: init.object_key,
        content_hash: contentHash,
        size_bytes: file.size,
        content_type: file.type,
      })
    } catch {
      throw new Error("upload_complete_failed")
    }
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
    return { attachments: [], rejected: 0, skipped, errors: [] }
  }

  const results = await Promise.allSettled(
    imageFiles.map(async (file) => buildImageAttachment(file))
  )

  const attachments: ChatImageAttachment[] = []
  let rejected = 0
  const errors: string[] = []
  results.forEach((result) => {
    if (result.status === "fulfilled") {
      attachments.push(result.value)
    } else {
      rejected += 1
      if (result.reason instanceof Error) {
        const code = result.reason.message || "upload_failed"
        errors.push(code)
      } else if (typeof result.reason === "string") {
        errors.push(result.reason)
      } else {
        errors.push("upload_failed")
      }
    }
  })

  if (errors.length) {
    console.warn("image_upload_failed", { errors })
  }

  return { attachments, rejected, skipped, errors }
}

export type { AttachmentBuildResult }
export { UPLOAD_ERROR_CODES }
