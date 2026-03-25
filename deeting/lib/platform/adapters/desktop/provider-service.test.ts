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

  it("uses local desktop preset registry for hub data", async () => {
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
        return Promise.resolve([
          {
            id: "inst-1",
            preset_slug: "volcengine-ark",
            name: "My Ark",
            base_url: "https://ark.cn-beijing.volces.com/api/v3",
            is_enabled: true,
            is_local: true,
            credentials_ref: "cred-1",
            created_at: "2026-03-21T00:00:00Z",
            updated_at: "2026-03-21T00:00:00Z",
          },
        ])
      }
      throw new Error(`unexpected command: ${command}`)
    })

    const result = await desktopProviderService.getHub({ include_public: true })

    expect(providerApi.fetchProviderHub).not.toHaveBeenCalled()
    expect(providerApi.fetchProviderPresetConfigs).not.toHaveBeenCalled()
    expect(mockInvoke).toHaveBeenCalledWith("list_local_provider_presets")
    expect(mockInvoke).toHaveBeenCalledWith("list_local_provider_instances")
    expect(result.providers[0]?.slug).toBe("volcengine-ark")
    expect(result.providers[0]?.connected).toBe(true)
    expect(result.providers[0]?.instances?.[0]?.name).toBe("My Ark")
    expect(result.stats.connected).toBe(1)
  })

  it("reads provider detail from local desktop preset registry", async () => {
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

    const result = await desktopProviderService.getDetail("volcengine-ark")

    expect(providerApi.fetchProviderDetail).not.toHaveBeenCalled()
    expect(result.slug).toBe("volcengine-ark")
    expect(result.name).toBe("Volcengine Ark")
    expect(result.provider).toBe("volcengine")
  })
})
