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

  it("uses public provider hub data and merges local desktop instances", async () => {
    ;(providerApi.fetchProviderHub as jest.Mock).mockResolvedValue({
      providers: [
        {
          slug: "openai",
          name: "OpenAI",
          provider: "openai",
          category: "cloud",
          description: null,
          icon: null,
          theme_color: null,
          base_url: "https://api.openai.com",
          url_template: null,
          tags: [],
          capabilities: ["chat"],
          is_popular: false,
          sort_order: 0,
          connected: false,
          instances: [],
        },
      ],
      stats: {
        total: 1,
        connected: 0,
        by_category: { cloud: 1 },
      },
    })
    mockInvoke.mockResolvedValue([
      {
        id: "inst-1",
        preset_slug: "openai",
        name: "My OpenAI",
        base_url: "https://api.openai.com",
        is_enabled: true,
        is_local: false,
        credentials_ref: "cred-1",
        created_at: "2026-03-21T00:00:00Z",
        updated_at: "2026-03-21T00:00:00Z",
      },
    ])

    const result = await desktopProviderService.getHub({ include_public: true })

    expect(providerApi.fetchProviderHub).toHaveBeenCalledWith({ include_public: true })
    expect(providerApi.fetchProviderPresetConfigs).not.toHaveBeenCalled()
    expect(mockInvoke).toHaveBeenCalledWith("list_local_provider_instances")
    expect(result.providers[0]?.connected).toBe(true)
    expect(result.providers[0]?.instances?.[0]?.name).toBe("My OpenAI")
    expect(result.stats.connected).toBe(1)
  })
})
