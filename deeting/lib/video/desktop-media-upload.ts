import { isTauriRuntime } from "@/lib/api/desktop-config"
import { prepareDesktopObjectStorageUpload } from "@/lib/api/desktop-object-storage"

export type DesktopVideoMediaSlot = "image" | "audio" | "video" | "end_image"

function buildObjectKey(file: File, slot: DesktopVideoMediaSlot) {
  const safeName =
    file.name
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "file"
  const id =
    typeof globalThis !== "undefined" && globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  return `video-inputs/${slot}/${id}-${safeName}`
}

function createLocalObjectUrl(file: File) {
  return URL.createObjectURL(file)
}

export async function resolveVideoInputUrl(
  file: File,
  slot: DesktopVideoMediaSlot
): Promise<string> {
  if (!isTauriRuntime()) {
    return createLocalObjectUrl(file)
  }

  try {
    const ticket = await prepareDesktopObjectStorageUpload({
      object_key: buildObjectKey(file, slot),
      content_type: file.type || null,
      expires_seconds: 900,
    })

    if (!ticket.asset_url) {
      return createLocalObjectUrl(file)
    }

    const headers = new Headers(ticket.headers ?? {})
    if (file.type && !headers.has("Content-Type")) {
      headers.set("Content-Type", file.type)
    }

    const response = await fetch(ticket.upload_url, {
      method: ticket.method || "PUT",
      headers,
      body: file,
    })
    if (!response.ok) {
      throw new Error(`video input upload failed: ${response.status}`)
    }
    return ticket.asset_url
  } catch (error) {
    console.warn("[video] desktop object storage upload skipped", error)
    return createLocalObjectUrl(file)
  }
}
