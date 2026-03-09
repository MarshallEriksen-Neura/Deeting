import {
  fetchPluginMarket,
  syncLocalSkillInstallsFromCloud,
} from "@/lib/api/plugin-market"
import { request } from "@/lib/http"
import { invoke } from "@tauri-apps/api/core"

jest.mock("@/lib/http", () => ({
  request: jest.fn(),
  getAuthToken: jest.fn(() => "desktop-token"),
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

describe("plugin market api", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
  })

  afterEach(() => {
    mockRequest.mockReset()
    mockInvoke.mockReset()
    process.env.NEXT_PUBLIC_IS_TAURI = originalTauriFlag
    delete windowWithTauri.__TAURI__
    delete windowWithTauri.__TAURI_INTERNALS__
  })

  it("syncs local skill installs from unified system assets", async () => {
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === "sync_local_system_assets") {
        return {
          fetched_count: 1,
          upserted_count: 1,
          hidden_count: 0,
          metadata_only_count: 0,
          executable_count: 1,
          archived_count: 0,
          skill_install_fetched_count: 1,
          skill_install_upserted_count: 1,
          skill_reinstalled_count: 0,
          skill_failed_count: 0,
          disabled_skill_count: 0,
          archived_assistant_count: 0,
          disabled_assistant_install_count: 0,
        }
      }
      return null
    })

    const result = await syncLocalSkillInstallsFromCloud({ force: true })

    expect(result?.fetched_count).toBe(1)
    expect(mockInvoke).toHaveBeenNthCalledWith(1, "sync_local_system_assets", {
      accessToken: "desktop-token",
      limit: 500,
      reinstallMissing: false,
    })
  })

  it("fetches plugin market after desktop sync", async () => {
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === "sync_local_system_assets") {
        return {
          fetched_count: 0,
          upserted_count: 0,
          hidden_count: 0,
          metadata_only_count: 0,
          executable_count: 0,
          archived_count: 0,
          skill_install_fetched_count: 0,
          skill_install_upserted_count: 0,
          skill_reinstalled_count: 0,
          skill_failed_count: 0,
          disabled_skill_count: 0,
          archived_assistant_count: 0,
          disabled_assistant_install_count: 0,
        }
      }
      return null
    })
    mockRequest.mockResolvedValue([
      {
        id: "skill.alpha",
        name: "Alpha Skill",
        description: "desc",
        version: "1.0.0",
        source_repo: null,
        source_revision: null,
        status: "active",
        installed: false,
      },
    ])

    const result = await fetchPluginMarket({ q: "alpha" })

    expect(result).toHaveLength(1)
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/api/v1/plugin-market/plugins",
        method: "GET",
        params: { q: "alpha" },
      })
    )
    expect(mockInvoke).toHaveBeenCalledWith("sync_local_system_assets", {
      accessToken: "desktop-token",
      limit: 500,
      reinstallMissing: false,
    })
  })
})