import { buildChatAttachments } from "@/lib/chat/attachments"
import { calculateFileHash } from "@/lib/utils/file"
import {
  fetchDesktopObjectStorageConfig,
  prepareDesktopObjectStorageRead,
  prepareDesktopObjectStorageUpload,
} from "@/lib/api/desktop-object-storage"

jest.mock("@/lib/utils/file", () => ({
  calculateFileHash: jest.fn(),
}))

jest.mock("@/lib/api/desktop-object-storage", () => ({
  fetchDesktopObjectStorageConfig: jest.fn(),
  prepareDesktopObjectStorageUpload: jest.fn(),
  prepareDesktopObjectStorageRead: jest.fn(),
}))

const mockCalculateFileHash = calculateFileHash as jest.MockedFunction<typeof calculateFileHash>
const mockFetchDesktopObjectStorageConfig =
  fetchDesktopObjectStorageConfig as jest.MockedFunction<typeof fetchDesktopObjectStorageConfig>
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
    mockFetchDesktopObjectStorageConfig.mockResolvedValue({
      id: "00000000-0000-0000-0000-000000000001",
      user_id: "00000000-0000-0000-0000-000000000002",
      provider: "cloudflare_r2_s3",
      bucket: "bucket",
      region: null,
      endpoint: "https://storage.example.com",
      public_base_url: null,
      path_prefix: "desktop/uploads",
      is_path_style: true,
      access_key_id: "access-key",
      has_secret: true,
      is_enabled: true,
      created_at: "2026-03-10T00:00:00Z",
      updated_at: "2026-03-10T00:00:00Z",
    })
  })

  afterEach(() => {
    mockCalculateFileHash.mockReset()
    mockFetchDesktopObjectStorageConfig.mockReset()
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

  it("does not silently downgrade to local image attachments when desktop object storage is enabled", async () => {
    mockPrepareUpload.mockRejectedValue(new Error("object storage unavailable"))

    const file = new File([new Uint8Array([1, 2, 3])], "demo.png", { type: "image/png" })
    const result = await buildChatAttachments([file])

    expect(result.attachments).toEqual([])
    expect(result.rejected).toBe(1)
    expect(result.errors).toContain("upload_init_failed")
  })
})
