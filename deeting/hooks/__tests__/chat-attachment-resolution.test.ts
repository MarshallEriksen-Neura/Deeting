import { resolveMessageAttachments } from "@/lib/chat/history-loader"
import { prepareDesktopObjectStorageRead } from "@/lib/api/desktop-object-storage"
import { signAssets } from "@/lib/api/media-assets"

jest.mock("@/lib/api/desktop-object-storage", () => ({
  prepareDesktopObjectStorageRead: jest.fn(),
}))

jest.mock("@/lib/api/media-assets", () => ({
  signAssets: jest.fn(),
}))

const mockPrepareRead = prepareDesktopObjectStorageRead as jest.MockedFunction<
  typeof prepareDesktopObjectStorageRead
>
const mockSignAssets = signAssets as jest.MockedFunction<typeof signAssets>

describe("resolveMessageAttachments", () => {
  afterEach(() => {
    mockPrepareRead.mockReset()
    mockSignAssets.mockReset()
  })

  it("uses desktop read tickets for tauri object storage attachments", async () => {
    mockPrepareRead.mockResolvedValue({
      provider: "cloudflare_r2_s3",
      object_key: "desktop/uploads/chat/demo.png",
      asset_url: "https://download.example.com/demo.png?sig=1",
      expires_at: "2026-03-10T00:15:00Z",
    })

    const resolved = await resolveMessageAttachments(
      [
        {
          id: "msg-1",
          role: "user",
          content: "hello",
          attachments: [
            {
              id: "att-1",
              kind: "image",
              objectKey: "desktop/uploads/chat/demo.png",
              url: "asset://desktop/uploads/chat/demo.png",
            },
          ],
        },
      ],
      true
    )

    expect(resolved[0]?.attachments?.[0]?.url).toBe("https://download.example.com/demo.png?sig=1")
    expect(mockPrepareRead).toHaveBeenCalledWith({
      object_key: "desktop/uploads/chat/demo.png",
      expires_seconds: 900,
    })
    expect(mockSignAssets).not.toHaveBeenCalled()
  })

  it("falls back to signAssets for unresolved tauri object keys", async () => {
    mockPrepareRead.mockRejectedValue(new Error("not desktop object storage"))
    mockSignAssets.mockResolvedValue({
      assets: [
        {
          object_key: "cloud/assets/demo.png",
          asset_url: "https://signed.example.com/cloud/assets/demo.png",
        },
      ],
    } as Awaited<ReturnType<typeof signAssets>>)

    const resolved = await resolveMessageAttachments(
      [
        {
          id: "msg-2",
          role: "assistant",
          content: "hello",
          attachments: [
            {
              id: "att-2",
              kind: "image",
              objectKey: "cloud/assets/demo.png",
              url: "asset://cloud/assets/demo.png",
            },
          ],
        },
      ],
      true
    )

    expect(resolved[0]?.attachments?.[0]?.url).toBe(
      "https://signed.example.com/cloud/assets/demo.png"
    )
    expect(mockSignAssets).toHaveBeenCalledWith(["cloud/assets/demo.png"])
  })
})
