import { buildChatAttachments } from "@/lib/chat/attachments"
import { calculateFileHash } from "@/lib/utils/file"
import {
  prepareDesktopObjectStorageRead,
  prepareDesktopObjectStorageUpload,
} from "@/lib/api/desktop-object-storage"

jest.mock("@/lib/utils/file", () => ({
  calculateFileHash: jest.fn(),
}))

jest.mock("@/lib/api/desktop-object-storage", () => ({
  prepareDesktopObjectStorageUpload: jest.fn(),
  prepareDesktopObjectStorageRead: jest.fn(),
}))

const mockCalculateFileHash = calculateFileHash as jest.MockedFunction<typeof calculateFileHash>
const mockPrepareUpload = prepareDesktopObjectStorageUpload as jest.MockedFunction<
  typeof prepareDesktopObjectStorageUpload
>
const mockPrepareRead = prepareDesktopObjectStorageRead as jest.MockedFunction<
  typeof prepareDesktopObjectStorageRead
>
const originalFetch = global.fetch
const originalTauriFlag = process.env.NEXT_PUBLIC_IS_TAURI
const windowWithTauri = window as Window & { __TAURI__?: unknown; __TAURI_INTERNALS__?: unknown }

describe("chat attachments", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as typeof fetch
    mockCalculateFileHash.mockResolvedValue("abc123")
  })

  afterEach(() => {
    mockCalculateFileHash.mockReset()
    mockPrepareUpload.mockReset()
    mockPrepareRead.mockReset()
    process.env.NEXT_PUBLIC_IS_TAURI = originalTauriFlag
    delete windowWithTauri.__TAURI__
    delete windowWithTauri.__TAURI_INTERNALS__
    global.fetch = originalFetch
  })

  it("stores desktop image attachments with objectKey and on-demand read url", async () => {
    mockPrepareUpload.mockResolvedValue({
      provider: "cloudflare_r2_s3",
      object_key: "desktop/uploads/chat-assets/abc123.png",
      upload_url: "https://upload.example.com/object",
      method: "PUT",
      headers: {},
      asset_url: null,
      expires_at: "2026-03-10T00:15:00Z",
    })
    mockPrepareRead.mockResolvedValue({
      provider: "cloudflare_r2_s3",
      object_key: "desktop/uploads/chat-assets/abc123.png",
      asset_url: "https://download.example.com/object?sig=1",
      expires_at: "2026-03-10T00:15:00Z",
    })

    const file = new File([new Uint8Array([1, 2, 3])], "demo.png", { type: "image/png" })
    Object.defineProperty(file, "arrayBuffer", {
      value: jest.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer),
    })
    const result = await buildChatAttachments([file])

    expect(result.rejected).toBe(0)
    expect(result.attachments[0]).toMatchObject({
      source: "oss",
      objectKey: "desktop/uploads/chat-assets/abc123.png",
      url: "https://download.example.com/object?sig=1",
      sha256: "abc123",
    })
  })
})