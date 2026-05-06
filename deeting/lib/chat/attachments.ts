import type { ChatAttachment } from "@/lib/chat/message-content"
import {
  fetchDesktopObjectStorageConfig,
  prepareDesktopObjectStorageRead,
  prepareDesktopObjectStorageUpload,
} from "@/lib/api/desktop-object-storage"
import { completeAssetUpload, initAssetUpload } from "@/lib/api/media-assets"
import { uploadModelFile } from "@/lib/api/model-files"
import { calculateFileHash } from "@/lib/utils/file"

type AttachmentBuildResult = {
  attachments: ChatAttachment[]
  rejected: number
  skipped: number
  errors: string[]
}

type AttachmentBuildOptions = {
  model?: string
  providerModelId?: string
  purpose?: string
}

const isTauriRuntime = () =>
  process.env.NEXT_PUBLIC_IS_TAURI === "true" &&
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<T>(command, args)
}

const createAttachmentId = () => {
  const cryptoObj = typeof globalThis !== "undefined" ? globalThis.crypto : undefined
  if (cryptoObj?.randomUUID) {
    return cryptoObj.randomUUID()
  }
  return `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

const hashFile = async (file: File) => {
  return calculateFileHash(file)
}

// Export for use in other modules
export { hashFile }

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
  "model_file_upload_failed",
  "model_file_missing_id",
])

const ATTACHMENT_INVALID_ERROR_CODES = new Set([
  "missing_model_context",
])

const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error("read_failed"))
    reader.readAsDataURL(file)
  })

const fileExtension = (file: File) => {
  const fromName = file.name.split(".").pop()?.trim().toLowerCase()
  if (fromName) return fromName
  const fromType = file.type.split("/").pop()?.trim().toLowerCase()
  if (fromType) return fromType
  return "bin"
}

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

const uploadFileBuffer = async (
  url: string,
  method: string,
  headers: Headers,
  file: File
) => {
  const body = await file.arrayBuffer()
  const response = await fetch(url, {
    method,
    headers,
    body,
  })
  if (!response.ok) {
    throw new Error("upload_put_failed")
  }
}

const buildDataUrlAttachment = async (file: File): Promise<ChatAttachment> => {
  const dataUrl = await fileToDataUrl(file)
  return {
    id: createAttachmentId(),
    kind: "image",
    url: dataUrl,
    name: file.name,
    size: file.size,
    type: file.type,
    source: "data",
  }
}

const buildLocalImageAttachment = async (file: File): Promise<ChatAttachment> => {
  const [contentHash, dataUrl] = await Promise.all([
    hashFile(file),
    fileToDataUrl(file),
  ])

  const rawBase64 = dataUrl.replace(/^data:[^;]+;base64,/, "")
  try {
    await invokeTauri("save_local_chat_asset", {
      payload: {
        content_base64: rawBase64,
        sha256: contentHash,
        content_type: file.type,
      },
    })
  } catch (err) {
    console.warn("save_local_chat_asset failed, using data URL", err)
  }

  return {
    id: createAttachmentId(),
    kind: "image",
    url: dataUrl,
    name: file.name,
    size: file.size,
    type: file.type,
    source: "local",
    sha256: contentHash,
  }
}

const buildDesktopObjectStorageImageAttachment = async (
  file: File
): Promise<ChatAttachment> => {
  const contentHash = await hashFile(file)
  const ticket = await prepareDesktopObjectStorageUpload({
    object_key: `chat-assets/${contentHash}.${fileExtension(file)}`,
    content_type: file.type || undefined,
    expires_seconds: 900,
  })

  const headers = new Headers(ticket.headers ?? {})
  await uploadFileBuffer(ticket.upload_url, ticket.method || "PUT", headers, file)

  let assetUrl = ticket.asset_url ?? undefined
  if (!assetUrl) {
    try {
      const readTicket = await prepareDesktopObjectStorageRead({
        object_key: ticket.object_key,
        expires_seconds: 900,
      })
      assetUrl = readTicket.asset_url
    } catch {
      assetUrl = undefined
    }
  }

  return {
    id: createAttachmentId(),
    kind: "image",
    url: assetUrl,
    name: file.name,
    size: file.size,
    type: file.type,
    source: "oss",
    objectKey: ticket.object_key,
    sha256: contentHash,
  }
}

const buildImageAttachment = async (file: File): Promise<ChatAttachment> => {
  let contentHash: string
  try {
    contentHash = await hashFile(file)
  } catch {
    // hash 失败也可以走 data URL fallback
    return buildDataUrlAttachment(file)
  }

  let init: Awaited<ReturnType<typeof initAssetUpload>>
  try {
    init = await initAssetUpload({
      content_hash: contentHash,
      size_bytes: file.size,
      content_type: file.type,
    })
  } catch {
    // OSS 未配置或不可用，fallback 到 base64 data URL
    return buildDataUrlAttachment(file)
  }

  let assetUrl = init.asset_url ?? undefined
  if (!init.deduped) {
    if (!init.upload_url) {
      return buildDataUrlAttachment(file)
    }
    const headers = buildUploadHeaders(init.upload_headers, file.type)
    try {
      await uploadFile(init.upload_url, headers, file)
    } catch {
      return buildDataUrlAttachment(file)
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
      return buildDataUrlAttachment(file)
    }
    assetUrl = completed.asset_url
  }

  if (!assetUrl) {
    return buildDataUrlAttachment(file)
  }

  return {
    id: createAttachmentId(),
    kind: "image",
    url: assetUrl,
    objectKey: init.object_key,
    name: file.name,
    size: file.size,
    type: file.type,
    source: "oss",
    sha256: contentHash,
  }
}

const buildModelFileAttachment = async (
  file: File,
  options: AttachmentBuildOptions
): Promise<ChatAttachment> => {
  let uploaded: Awaited<ReturnType<typeof uploadModelFile>>
  try {
    uploaded = await uploadModelFile({
      file,
      purpose: options.purpose,
      model: options.model,
      providerModelId: options.providerModelId,
    })
  } catch {
    throw new Error("model_file_upload_failed")
  }

  const fileId = typeof uploaded.id === "string" ? uploaded.id.trim() : ""
  if (!fileId) {
    throw new Error("model_file_missing_id")
  }

  return {
    id: createAttachmentId(),
    kind: "file",
    fileId,
    name:
      typeof uploaded.filename === "string" && uploaded.filename.trim()
        ? uploaded.filename.trim()
        : file.name,
    size: file.size,
    type: file.type,
    source: "model",
  }
}

const buildAttachment = async (
  file: File,
  options: AttachmentBuildOptions
): Promise<ChatAttachment> => {
  if (file.type.startsWith("image/")) {
    if (isTauriRuntime()) {
      const desktopObjectStorageConfig = await fetchDesktopObjectStorageConfig().catch(() => null)
      try {
        return await buildDesktopObjectStorageImageAttachment(file)
      } catch {
        if (desktopObjectStorageConfig?.is_enabled) {
          throw new Error("upload_init_failed")
        }
      }
      return buildLocalImageAttachment(file)
    }
    return buildImageAttachment(file)
  }

  if (!options.model && !options.providerModelId) {
    throw new Error("missing_model_context")
  }

  return buildModelFileAttachment(file, options)
}

export async function buildChatAttachments(
  files: File[],
  options: AttachmentBuildOptions = {}
): Promise<AttachmentBuildResult> {
  if (!files.length) {
    return { attachments: [], rejected: 0, skipped: 0, errors: [] }
  }

  const results = await Promise.allSettled(
    files.map(async (file) => buildAttachment(file, options))
  )

  const attachments: ChatAttachment[] = []
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
    console.warn("attachment_upload_failed", { errors })
  }

  return { attachments, rejected, skipped: 0, errors }
}

// 兼容旧调用名
export async function buildImageAttachments(
  files: File[]
): Promise<AttachmentBuildResult> {
  return buildChatAttachments(files)
}

export type { AttachmentBuildResult, AttachmentBuildOptions }
export { UPLOAD_ERROR_CODES, ATTACHMENT_INVALID_ERROR_CODES }
