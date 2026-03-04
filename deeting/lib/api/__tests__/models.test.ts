import { fetchChatModels } from "@/lib/api/models"
import { request } from "@/lib/http"
import { invoke } from "@tauri-apps/api/core"

jest.mock("@/lib/http", () => ({
  request: jest.fn(),
}))

jest.mock("@tauri-apps/api/core", () => ({
  invoke: jest.fn(),
}))

const mockRequest = request as jest.MockedFunction<typeof request>
const mockInvoke = invoke as jest.MockedFunction<typeof invoke>
const originalTauriFlag = process.env.NEXT_PUBLIC_IS_TAURI
const windowWithTauri = window as Window & {
  __TAURI__?: unknown
  __TAURI_INTERNALS__?: unknown
}

describe("models api", () => {
  afterEach(() => {
    mockRequest.mockReset()
    mockInvoke.mockReset()
    process.env.NEXT_PUBLIC_IS_TAURI = originalTauriFlag
    delete windowWithTauri.__TAURI__
    delete windowWithTauri.__TAURI_INTERNALS__
    jest.restoreAllMocks()
  })

  it("merges local and cloud models in tauri runtime with route markers", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}

    mockInvoke
      .mockResolvedValueOnce([
        {
          id: "inst-local-1",
          name: "Local Provider",
          preset_slug: "ollama",
          icon: null,
          is_enabled: true,
        },
      ] as unknown)
      .mockResolvedValueOnce([
        {
          id: "pm-local-1",
          instance_id: "inst-local-1",
          model_id: "llama3.1:8b",
          unified_model_id: null,
          capabilities: ["chat"],
          is_active: true,
          extra_meta: { input_types: ["text"] },
        },
      ] as unknown)

    mockRequest.mockResolvedValue({
      instances: [
        {
          instance_id: "inst-cloud-1",
          instance_name: "Cloud Gateway",
          provider: "openai",
          icon: null,
          models: [
            {
              id: "gpt-4o",
              object: "model",
              owned_by: "openai",
              provider_model_id: "pm-cloud-1",
            },
          ],
        },
      ],
    })

    const result = await fetchChatModels({ capability: "chat" })
    const local = result.instances.find((item) => item.instance_id === "inst-local-1")
    const cloud = result.instances.find((item) => item.instance_id === "inst-cloud-1")

    expect(local?.models[0]?.provider_model_id).toBe("pm-local-1")
    expect(local?.models[0]?.request_route).toBe("local_invoke")
    expect(local?.models[0]?.runtime_source).toBe("desktop_local")

    expect(cloud?.models[0]?.provider_model_id).toBe("pm-cloud-1")
    expect(cloud?.models[0]?.request_route).toBe("cloud_http")
    expect(cloud?.models[0]?.runtime_source).toBe("cloud_internal")

    expect(mockInvoke).toHaveBeenCalledWith("list_local_provider_instances", undefined)
    expect(mockRequest).toHaveBeenCalledTimes(1)
  })

  it("uses cloud model list in non-tauri runtime", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "false"

    mockRequest.mockResolvedValue({
      instances: [
        {
          instance_id: "inst-cloud-2",
          instance_name: "Cloud",
          provider: "openai",
          icon: null,
          models: [
            {
              id: "gpt-4.1",
              object: "model",
              owned_by: "openai",
              provider_model_id: "pm-cloud-2",
            },
          ],
        },
      ],
    })

    const result = await fetchChatModels()
    expect(result.instances).toHaveLength(1)
    expect(result.instances[0]?.models[0]?.request_route).toBe("cloud_http")
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it("falls back to cloud list when local loading fails in tauri runtime", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI_INTERNALS__ = {}
    jest.spyOn(console, "warn").mockImplementation(() => {})

    mockInvoke.mockRejectedValue(new Error("tauri local provider unavailable"))
    mockRequest.mockResolvedValue({
      instances: [
        {
          instance_id: "inst-cloud-3",
          instance_name: "Cloud",
          provider: "openai",
          icon: null,
          models: [
            {
              id: "gpt-4o-mini",
              object: "model",
              owned_by: "openai",
              provider_model_id: "pm-cloud-3",
            },
          ],
        },
      ],
    })

    const result = await fetchChatModels()
    expect(result.instances).toHaveLength(1)
    expect(result.instances[0]?.models[0]?.request_route).toBe("cloud_http")
    expect(mockRequest).toHaveBeenCalledTimes(1)
  })
})
