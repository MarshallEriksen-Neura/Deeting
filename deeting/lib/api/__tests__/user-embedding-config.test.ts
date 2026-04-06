import {
  fetchUserEmbeddingConfig,
  updateUserEmbeddingConfig,
} from "@/lib/api/user-embedding-config"
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

const localEmbeddingConfig = {
  id: "11111111-1111-4111-8111-111111111111",
  user_id: "00000000-0000-0000-0000-000000000000",
  provider_model_id: "22222222-2222-4222-8222-222222222222",
  multimodal_provider_model_id: "33333333-3333-4333-8333-333333333333",
  created_at: "2026-03-03T00:00:00Z",
  updated_at: "2026-03-03T00:00:01Z",
}

describe("user embedding config api", () => {
  afterEach(() => {
    mockInvoke.mockReset()
    process.env.NEXT_PUBLIC_IS_TAURI = originalTauriFlag
    delete windowWithTauri.__TAURI__
    delete windowWithTauri.__TAURI_INTERNALS__
  })

  it("fetches user embedding config via tauri command", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue(localEmbeddingConfig as unknown)

    const result = await fetchUserEmbeddingConfig()

    expect(result).toEqual(localEmbeddingConfig)
    expect(mockInvoke).toHaveBeenCalledWith("get_local_user_embedding_config", undefined)
  })

  it("updates user embedding config via tauri command", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue({
      ...localEmbeddingConfig,
      updated_at: "2026-03-03T00:10:00Z",
    } as unknown)

    const result = await updateUserEmbeddingConfig({
      provider_model_id: localEmbeddingConfig.provider_model_id,
      multimodal_provider_model_id: localEmbeddingConfig.multimodal_provider_model_id,
    })

    expect(result.provider_model_id).toBe(localEmbeddingConfig.provider_model_id)
    expect(result.multimodal_provider_model_id).toBe(
      localEmbeddingConfig.multimodal_provider_model_id
    )
    expect(mockInvoke).toHaveBeenCalledWith("update_local_user_embedding_config", {
      payload: {
        provider_model_id: localEmbeddingConfig.provider_model_id,
        multimodal_provider_model_id: localEmbeddingConfig.multimodal_provider_model_id,
      },
    })
  })

  it("throws outside tauri runtime", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "false"

    await expect(fetchUserEmbeddingConfig()).rejects.toThrow(
      "user embedding config is only available in desktop runtime"
    )
    expect(mockInvoke).not.toHaveBeenCalled()
  })
})
