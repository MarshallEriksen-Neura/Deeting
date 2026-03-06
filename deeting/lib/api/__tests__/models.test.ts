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
const originalDesktopIncludeCloudFlag = process.env.NEXT_PUBLIC_DESKTOP_INCLUDE_CLOUD_MODELS
const windowWithTauri = window as Window & {
  __TAURI__?: unknown
  __TAURI_INTERNALS__?: unknown
}

describe("models api", () => {
  afterEach(() => {
    mockRequest.mockReset()
    mockInvoke.mockReset()
    process.env.NEXT_PUBLIC_IS_TAURI = originalTauriFlag
    process.env.NEXT_PUBLIC_DESKTOP_INCLUDE_CLOUD_MODELS = originalDesktopIncludeCloudFlag
    delete windowWithTauri.__TAURI__
    delete windowWithTauri.__TAURI_INTERNALS__
    jest.restoreAllMocks()
  })

  it("uses local model list only in tauri runtime by default", async () => {
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

    const result = await fetchChatModels({ capability: "chat" })
    const local = result.instances.find((item) => item.instance_id === "inst-local-1")
    const cloud = result.instances.find((item) => item.instance_id === "inst-cloud-1")

    expect(local?.models[0]?.provider_model_id).toBe("pm-local-1")
    expect(local?.models[0]?.request_route).toBe("local_invoke")
    expect(local?.models[0]?.runtime_source).toBe("desktop_local")

    expect(cloud).toBeUndefined()

    expect(mockInvoke).toHaveBeenCalledWith("list_local_provider_instances", undefined)
    expect(mockInvoke).toHaveBeenCalledWith("list_local_provider_models", {
      instanceId: "inst-local-1",
    })
    expect(mockRequest).not.toHaveBeenCalled()
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

  it("uses local model list when tauri globals exist even if env flag is false", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "false"
    windowWithTauri.__TAURI_INTERNALS__ = {}

    mockInvoke
      .mockResolvedValueOnce([
        {
          id: "inst-local-2",
          name: "Local Provider 2",
          preset_slug: "ollama",
          icon: null,
          is_enabled: true,
        },
      ] as unknown)
      .mockResolvedValueOnce([
        {
          id: "pm-local-2",
          instance_id: "inst-local-2",
          model_id: "qwen2.5:7b",
          unified_model_id: null,
          capabilities: ["chat"],
          is_active: true,
          extra_meta: { input_types: ["text"] },
        },
      ] as unknown)

    const result = await fetchChatModels({ capability: "chat" })
    expect(result.instances).toHaveLength(1)
    expect(result.instances[0]?.instance_id).toBe("inst-local-2")
    expect(result.instances[0]?.models[0]?.request_route).toBe("local_invoke")
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("can merge local and cloud models in tauri runtime when explicitly enabled", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    process.env.NEXT_PUBLIC_DESKTOP_INCLUDE_CLOUD_MODELS = "true"
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
    expect(mockRequest).toHaveBeenCalledTimes(1)
  })

  it("does not call cloud list when local loading fails in tauri runtime by default", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI_INTERNALS__ = {}
    jest.spyOn(console, "warn").mockImplementation(() => {})

    mockInvoke.mockRejectedValue(new Error("tauri local provider unavailable"))

    const result = await fetchChatModels()
    expect(result.instances).toHaveLength(0)
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("matches local capability aliases like cloud filtering", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}

    mockInvoke
      .mockResolvedValueOnce([
        {
          id: "inst-local-video",
          name: "Local Video Provider",
          preset_slug: "custom",
          icon: null,
          is_enabled: true,
        },
      ] as unknown)
      .mockResolvedValueOnce([
        {
          id: "pm-local-video",
          instance_id: "inst-local-video",
          model_id: "wanx-local",
          unified_model_id: null,
          capabilities: ["video"],
          is_active: true,
          extra_meta: {},
        },
      ] as unknown)

    const result = await fetchChatModels({ capability: "video_generation" })
    expect(result.instances).toHaveLength(1)
    expect(result.instances[0]?.models[0]?.provider_model_id).toBe("pm-local-video")
  })

  it("falls back to routing and upstream capabilities for local filtering", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}

    mockInvoke
      .mockResolvedValueOnce([
        {
          id: "inst-local-routing",
          name: "Local Routing Provider",
          preset_slug: "custom",
          icon: null,
          is_enabled: true,
        },
      ] as unknown)
      .mockResolvedValueOnce([
        {
          id: "pm-local-routing",
          instance_id: "inst-local-routing",
          model_id: "wanx-routing-only",
          unified_model_id: null,
          capabilities: [],
          routing_config: { capabilities: ["video_generation"] },
          is_active: true,
          extra_meta: { upstream_capabilities: ["video_generation"] },
        },
      ] as unknown)

    const result = await fetchChatModels({ capability: "video_generation" })
    expect(result.instances).toHaveLength(1)
    expect(result.instances[0]?.models[0]?.provider_model_id).toBe("pm-local-routing")
  })
})
