import { desktopProviderService } from "./provider-service"
import * as providerApi from "@/lib/api/providers"

const mockInvoke = jest.fn()

jest.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

jest.mock("@/lib/api/providers", () => ({
  fetchProviderHub: jest.fn(),
  fetchProviderDetail: jest.fn(),
  fetchProviderPresetConfigs: jest.fn(),
}))

describe("desktopProviderService", () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    ;(providerApi.fetchProviderHub as jest.Mock).mockReset()
    ;(providerApi.fetchProviderDetail as jest.Mock).mockReset()
    ;(providerApi.fetchProviderPresetConfigs as jest.Mock).mockReset()
  })

  it("syncs cloud presets into the local desktop registry before reading hub data", async () => {
    ;(providerApi.fetchProviderPresetConfigs as jest.Mock).mockResolvedValue([
      {
        slug: "openai",
        name: "OpenAI",
        provider: "openai",
        category: "cloud api",
        base_url: "https://api.openai.com",
        icon: "https://openai.com/favicon.ico",
        theme_color: "#10A37F",
        url_template: "https://platform.openai.com/docs",
        auth_type: "bearer",
        auth_config: { header: "Authorization" },
        protocol_schema_version: "desktop_local_unified_v1",
        protocol_profiles: { chat: { transport: { path: "chat/completions" } } },
        version: 3,
        is_active: true,
      },
    ])

    mockInvoke.mockImplementation((command: string) => {
      if (command === "replace_local_provider_presets") {
        return Promise.resolve(1)
      }
      if (command === "list_local_provider_presets") {
        return Promise.resolve([
          {
            slug: "openai",
            name: "OpenAI",
            provider: "openai",
            category: "cloud api",
            base_url: "https://api.openai.com",
            icon: "https://openai.com/favicon.ico",
            theme_color: "#10A37F",
            url_template: "https://platform.openai.com/docs",
            auth_type: "bearer",
            auth_config: { header: "Authorization" },
            protocol_schema_version: "desktop_local_unified_v1",
            protocol_profiles: { chat: { transport: { path: "chat/completions" } } },
            version: 3,
            is_active: true,
          },
        ])
      }
      if (command === "list_local_provider_instances") {
        return Promise.resolve([])
      }
      throw new Error(`unexpected command: ${command}`)
    })

    const result = await desktopProviderService.getHub({ include_public: true })

    expect(providerApi.fetchProviderHub).not.toHaveBeenCalled()
    expect(providerApi.fetchProviderPresetConfigs).toHaveBeenCalledTimes(1)
    expect(mockInvoke).toHaveBeenCalledWith("replace_local_provider_presets", {
      presets: [
        {
          slug: "openai",
          name: "OpenAI",
          provider: "openai",
          category: "cloud api",
          base_url: "https://api.openai.com",
          icon: "https://openai.com/favicon.ico",
          theme_color: "#10A37F",
          url_template: "https://platform.openai.com/docs",
          auth_type: "bearer",
          auth_config: { header: "Authorization" },
          protocol_schema_version: "desktop_local_unified_v1",
          protocol_profiles: { chat: { transport: { path: "chat/completions" } } },
          version: 3,
          is_active: true,
        },
      ],
    })
    expect(mockInvoke).toHaveBeenCalledWith("list_local_provider_presets")
    expect(mockInvoke).toHaveBeenCalledWith("list_local_provider_instances")
    expect(result.providers[0]?.slug).toBe("openai")
    expect(result.providers[0]?.connected).toBe(false)
    expect(result.stats.connected).toBe(0)
  })

  it("falls back to the local desktop preset registry when cloud sync fails", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined)
    ;(providerApi.fetchProviderPresetConfigs as jest.Mock).mockRejectedValue(
      new Error("cloud unavailable")
    )

    mockInvoke.mockImplementation((command: string) => {
      if (command === "list_local_provider_presets") {
        return Promise.resolve([
          {
            slug: "volcengine-ark",
            name: "Volcengine Ark",
            provider: "volcengine",
            category: "llm",
            base_url: "https://ark.cn-beijing.volces.com/api/v3",
            icon: "https://www.volcengine.com/favicon.ico",
            theme_color: "#1F6BFF",
            url_template: "https://www.volcengine.com/docs/82379",
            auth_type: "bearer",
            auth_config: {},
            protocol_schema_version: "desktop_local_unified_v1",
            protocol_profiles: {},
            version: 1,
            is_active: true,
          },
        ])
      }
      if (command === "list_local_provider_instances") {
        return Promise.resolve([])
      }
      throw new Error(`unexpected command: ${command}`)
    })

    const result = await desktopProviderService.getHub({ include_public: true })

    expect(providerApi.fetchProviderPresetConfigs).toHaveBeenCalledTimes(1)
    expect(mockInvoke).not.toHaveBeenCalledWith("replace_local_provider_presets", expect.anything())
    expect(result.providers[0]?.slug).toBe("volcengine-ark")
    expect(warnSpy).toHaveBeenCalled()

    warnSpy.mockRestore()
  })

  it("reads provider detail from local desktop preset registry", async () => {
    ;(providerApi.fetchProviderPresetConfigs as jest.Mock).mockResolvedValue([
      {
        slug: "volcengine-ark",
        name: "Volcengine Ark",
        provider: "volcengine",
        category: "llm",
        base_url: "https://ark.cn-beijing.volces.com/api/v3",
        icon: "https://www.volcengine.com/favicon.ico",
        theme_color: "#1F6BFF",
        url_template: "https://www.volcengine.com/docs/82379",
        auth_type: "bearer",
        auth_config: {},
        protocol_schema_version: "desktop_local_unified_v1",
        protocol_profiles: {},
        version: 1,
        is_active: true,
      },
    ])

    mockInvoke.mockImplementation((command: string) => {
      if (command === "replace_local_provider_presets") {
        return Promise.resolve(1)
      }
      if (command === "list_local_provider_presets") {
        return Promise.resolve([
          {
            slug: "volcengine-ark",
            name: "Volcengine Ark",
            provider: "volcengine",
            category: "llm",
            base_url: "https://ark.cn-beijing.volces.com/api/v3",
            icon: "https://www.volcengine.com/favicon.ico",
            theme_color: "#1F6BFF",
            url_template: "https://www.volcengine.com/docs/82379",
            auth_type: "bearer",
            auth_config: {},
            protocol_schema_version: "desktop_local_unified_v1",
            protocol_profiles: {},
            version: 1,
            is_active: true,
          },
        ])
      }
      if (command === "list_local_provider_instances") {
        return Promise.resolve([])
      }
      throw new Error(`unexpected command: ${command}`)
    })

    const result = await desktopProviderService.getDetail("volcengine-ark")

    expect(providerApi.fetchProviderDetail).not.toHaveBeenCalled()
    expect(result.slug).toBe("volcengine-ark")
    expect(result.name).toBe("Volcengine Ark")
    expect(result.provider).toBe("volcengine")
  })
})
