import { resolveVideoInputUrl } from "@/lib/video/desktop-media-upload"
import { prepareDesktopObjectStorageUpload } from "@/lib/api/desktop-object-storage"

jest.mock("@/lib/api/desktop-object-storage", () => ({
  prepareDesktopObjectStorageUpload: jest.fn(),
}))

const mockPrepareDesktopObjectStorageUpload =
  prepareDesktopObjectStorageUpload as jest.MockedFunction<
    typeof prepareDesktopObjectStorageUpload
  >

const originalFetch = global.fetch
const originalCreateObjectURL = URL.createObjectURL
const originalWarn = console.warn
const originalTauriFlag = process.env.NEXT_PUBLIC_IS_TAURI
const windowWithTauri = window as Window & {
  __TAURI__?: unknown
  __TAURI_INTERNALS__?: unknown
}

describe("desktop media upload", () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true } as Response)
    URL.createObjectURL = jest.fn(() => "blob:local-preview")
    console.warn = jest.fn()
  })

  afterEach(() => {
    mockPrepareDesktopObjectStorageUpload.mockReset()
    global.fetch = originalFetch
    URL.createObjectURL = originalCreateObjectURL
    console.warn = originalWarn
    process.env.NEXT_PUBLIC_IS_TAURI = originalTauriFlag
    delete windowWithTauri.__TAURI__
    delete windowWithTauri.__TAURI_INTERNALS__
  })

  it("uploads video input file to desktop object storage in tauri runtime", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockPrepareDesktopObjectStorageUpload.mockResolvedValue({
      provider: "cloudflare_r2_s3",
      object_key: "video-inputs/image/demo.png",
      upload_url: "https://example.r2.cloudflarestorage.com/upload",
      method: "PUT",
      headers: {},
      asset_url: "https://cdn.example.com/video-inputs/image/demo.png",
      expires_at: "2026-03-10T00:15:00Z",
    })

    const file = new File(["hello"], "demo.png", { type: "image/png" })
    const url = await resolveVideoInputUrl(file, "image")

    expect(url).toBe("https://cdn.example.com/video-inputs/image/demo.png")
    expect(mockPrepareDesktopObjectStorageUpload).toHaveBeenCalledWith({
      object_key: expect.stringContaining("video-inputs/image/"),
      content_type: "image/png",
      expires_seconds: 900,
    })
    expect(global.fetch).toHaveBeenCalledWith(
      "https://example.r2.cloudflarestorage.com/upload",
      expect.objectContaining({ method: "PUT" })
    )
  })

  it("falls back to blob url when desktop object storage is unavailable", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockPrepareDesktopObjectStorageUpload.mockRejectedValue(new Error("missing config"))

    const file = new File(["hello"], "demo.mp3", { type: "audio/mpeg" })
    const url = await resolveVideoInputUrl(file, "audio")

    expect(url).toBe("blob:local-preview")
    expect(URL.createObjectURL).toHaveBeenCalledWith(file)
  })
})
