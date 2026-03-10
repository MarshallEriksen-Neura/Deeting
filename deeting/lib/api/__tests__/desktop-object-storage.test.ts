import {
  clearDesktopObjectStorageConfig,
  deleteDesktopObjectStorageObject,
  fetchDesktopObjectStorageConfig,
  prepareDesktopObjectStorageRead,
  prepareDesktopObjectStorageUpload,
  updateDesktopObjectStorageConfig,
} from "@/lib/api/desktop-object-storage"
import { invoke } from "@tauri-apps/api/core"

jest.mock("@tauri-apps/api/core", () => ({
  invoke: jest.fn(),
}))

const mockInvoke = invoke as jest.MockedFunction<typeof invoke>
const originalTauriFlag = process.env.NEXT_PUBLIC_IS_TAURI
const windowWithTauri = window as Window & {
  __TAURI__?: unknown
  __TAURI_INTERNALS__?: unknown
}

const localConfig = {
  id: "11111111-1111-4111-8111-111111111111",
  user_id: "00000000-0000-0000-0000-000000000000",
  provider: "cloudflare_r2_s3",
  bucket: "demo-bucket",
  region: "auto",
  endpoint: "https://example.r2.cloudflarestorage.com",
  public_base_url: "https://cdn.example.com/assets",
  path_prefix: "desktop/uploads",
  is_path_style: false,
  access_key_id: "AKIA-DEMO",
  has_secret: true,
  is_enabled: true,
  created_at: "2026-03-10T00:00:00Z",
  updated_at: "2026-03-10T00:00:01Z",
}

const uploadTicket = {
  provider: "cloudflare_r2_s3",
  object_key: "desktop/uploads/chat/demo.png",
  upload_url:
    "https://demo-bucket.example.r2.cloudflarestorage.com/desktop/uploads/chat/demo.png?X-Amz-Algorithm=AWS4-HMAC-SHA256",
  method: "PUT",
  headers: {},
  asset_url: "https://cdn.example.com/assets/desktop/uploads/chat/demo.png",
  expires_at: "2026-03-10T00:15:00Z",
}

const readTicket = {
  provider: "cloudflare_r2_s3",
  object_key: "desktop/uploads/chat/demo.png",
  asset_url:
    "https://demo-bucket.example.r2.cloudflarestorage.com/desktop/uploads/chat/demo.png?X-Amz-Algorithm=AWS4-HMAC-SHA256",
  expires_at: "2026-03-10T00:15:00Z",
}

describe("desktop object storage api", () => {
  afterEach(() => {
    mockInvoke.mockReset()
    process.env.NEXT_PUBLIC_IS_TAURI = originalTauriFlag
    delete windowWithTauri.__TAURI__
    delete windowWithTauri.__TAURI_INTERNALS__
  })

  it("fetches config via tauri command", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue(localConfig as unknown)

    const result = await fetchDesktopObjectStorageConfig()

    expect(result).toEqual(localConfig)
    expect(mockInvoke).toHaveBeenCalledWith(
      "get_local_desktop_object_storage_config",
      undefined
    )
  })

  it("updates config via tauri command", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue({
      ...localConfig,
      provider: "aliyun_oss",
      endpoint: "https://oss-cn-hangzhou.aliyuncs.com",
      updated_at: "2026-03-10T00:10:00Z",
    } as unknown)

    const result = await updateDesktopObjectStorageConfig({
      provider: "aliyun_oss",
      bucket: "demo-bucket",
      region: "cn-hangzhou",
      endpoint: "https://oss-cn-hangzhou.aliyuncs.com",
      public_base_url: "https://cdn.example.com/assets",
      path_prefix: "knowledge",
      access_key_id: "ALIYUN-ID",
      secret_access_key: "ALIYUN-SECRET",
      is_path_style: true,
      is_enabled: true,
    })

    expect(result.provider).toBe("aliyun_oss")
    expect(mockInvoke).toHaveBeenCalledWith(
      "update_local_desktop_object_storage_config",
      {
        payload: {
          provider: "aliyun_oss",
          bucket: "demo-bucket",
          region: "cn-hangzhou",
          endpoint: "https://oss-cn-hangzhou.aliyuncs.com",
          public_base_url: "https://cdn.example.com/assets",
          path_prefix: "knowledge",
          access_key_id: "ALIYUN-ID",
          secret_access_key: "ALIYUN-SECRET",
          is_path_style: true,
          is_enabled: true,
        },
      }
    )
  })

  it("clears config via tauri command", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue(true as unknown)

    const result = await clearDesktopObjectStorageConfig()

    expect(result).toBe(true)
    expect(mockInvoke).toHaveBeenCalledWith(
      "clear_local_desktop_object_storage_config",
      undefined
    )
  })

  it("deletes object via tauri command", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue(true as unknown)

    const result = await deleteDesktopObjectStorageObject("desktop/uploads/chat/demo.png")

    expect(result).toBe(true)
    expect(mockInvoke).toHaveBeenCalledWith(
      "delete_local_desktop_object_storage_object",
      {
        object_key: "desktop/uploads/chat/demo.png",
      }
    )
  })

  it("prepares upload ticket via tauri command", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue(uploadTicket as unknown)

    const result = await prepareDesktopObjectStorageUpload({
      object_key: "chat/demo.png",
      content_type: "image/png",
      expires_seconds: 600,
    })

    expect(result).toEqual(uploadTicket)
    expect(mockInvoke).toHaveBeenCalledWith(
      "prepare_local_desktop_object_storage_upload",
      {
        payload: {
          object_key: "chat/demo.png",
          content_type: "image/png",
          expires_seconds: 600,
        },
      }
    )
  })

  it("prepares read ticket via tauri command", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue(readTicket as unknown)

    const result = await prepareDesktopObjectStorageRead({
      object_key: "chat/demo.png",
      expires_seconds: 600,
    })

    expect(result).toEqual(readTicket)
    expect(mockInvoke).toHaveBeenCalledWith(
      "prepare_local_desktop_object_storage_read",
      {
        payload: {
          object_key: "chat/demo.png",
          expires_seconds: 600,
        },
      }
    )
  })

  it("returns null outside tauri runtime", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "false"

    const result = await fetchDesktopObjectStorageConfig()

    expect(result).toBeNull()
    expect(mockInvoke).not.toHaveBeenCalled()
  })
})
