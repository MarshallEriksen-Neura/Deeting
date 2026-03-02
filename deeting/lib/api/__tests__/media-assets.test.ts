import {
  completeAssetUpload,
  initAssetUpload,
  signAssets,
} from "@/lib/api/media-assets"
import { request } from "@/lib/http"

jest.mock("@/lib/http", () => ({
  request: jest.fn(),
}))

const mockRequest = request as jest.MockedFunction<typeof request>

describe("media assets api", () => {
  afterEach(() => {
    mockRequest.mockReset()
  })

  it("calls init upload endpoint with api v1 prefix", async () => {
    mockRequest.mockResolvedValue({
      deduped: false,
      object_key: "assets/avatar.png",
      asset_url: null,
      upload_url: "https://oss.example.com/upload",
      upload_headers: null,
      expires_in: 600,
    })

    await initAssetUpload(
      {
        content_hash: "abc",
        size_bytes: 12,
        content_type: "image/png",
        kind: "avatar",
      },
      "public"
    )

    expect(mockRequest).toHaveBeenCalledWith({
      url: "/api/v1/media/assets/upload/init?bucket_type=public",
      method: "POST",
      data: {
        content_hash: "abc",
        size_bytes: 12,
        content_type: "image/png",
        kind: "avatar",
      },
    })
  })

  it("calls complete upload endpoint with api v1 prefix", async () => {
    mockRequest.mockResolvedValue({
      object_key: "assets/avatar.png",
      asset_url: "https://example.com/avatar.png",
    })

    await completeAssetUpload(
      {
        object_key: "assets/avatar.png",
        content_hash: "abc",
        size_bytes: 12,
        content_type: "image/png",
      },
      "public"
    )

    expect(mockRequest).toHaveBeenCalledWith({
      url: "/api/v1/media/assets/upload/complete?bucket_type=public",
      method: "POST",
      data: {
        object_key: "assets/avatar.png",
        content_hash: "abc",
        size_bytes: 12,
        content_type: "image/png",
      },
    })
  })

  it("calls sign endpoint with api v1 prefix", async () => {
    mockRequest.mockResolvedValue({
      assets: [
        {
          object_key: "assets/avatar.png",
          asset_url: "https://example.com/avatar.png",
        },
      ],
    })

    await signAssets(["assets/avatar.png"], 300)

    expect(mockRequest).toHaveBeenCalledWith({
      url: "/api/v1/media/assets/sign",
      method: "POST",
      data: {
        object_keys: ["assets/avatar.png"],
        expires_seconds: 300,
      },
    })
  })
})
