import {
  repairLocalSystemAssetIndexFromCloud,
  syncLocalSystemAssetsFromCloud,
  tryRepairLocalSystemAssetIndexFromCloud,
} from "@/lib/api/desktop-system-assets"
import { invoke } from "@tauri-apps/api/core"

jest.mock("@tauri-apps/api/core", () => ({
  invoke: jest.fn(),
}))

jest.mock("@/lib/http", () => ({
  getAuthToken: jest.fn(() => "desktop-token"),
}))

const mockInvoke = invoke as jest.MockedFunction<typeof invoke>
const originalTauriFlag = process.env.NEXT_PUBLIC_IS_TAURI
const windowWithTauri = window as Window & {
  __TAURI__?: unknown
  __TAURI_INTERNALS__?: unknown
}

describe("desktop system assets api", () => {
  afterEach(() => {
    mockInvoke.mockReset()
    process.env.NEXT_PUBLIC_IS_TAURI = originalTauriFlag
    delete windowWithTauri.__TAURI__
    delete windowWithTauri.__TAURI_INTERNALS__
  })

  it("syncs local system assets via tauri command", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue({
      fetched_count: 1,
      assistant_fetched_count: 1,
      skill_fetched_count: 0,
      upserted_count: 1,
      hidden_count: 0,
      metadata_only_count: 0,
      executable_count: 1,
      archived_count: 0,
      skill_install_fetched_count: 0,
      skill_install_upserted_count: 0,
      skill_reinstalled_count: 0,
      skill_failed_count: 0,
      disabled_skill_count: 0,
      archived_assistant_count: 0,
    } as unknown)

    const result = await syncLocalSystemAssetsFromCloud({ force: true, limit: 42 })

    expect(result?.fetched_count).toBe(1)
    expect(mockInvoke).toHaveBeenCalledWith("sync_local_system_assets", {
      accessToken: "desktop-token",
      limit: 42,
      reinstallMissing: false,
    })
  })

  it("repairs local system asset index via tauri command", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue({
      vector_dimension: 1536,
      skill_reindexed_count: 3,
      assistant_reindexed_count: 2,
      sync: {
        fetched_count: 2,
        assistant_fetched_count: 1,
        skill_fetched_count: 1,
        upserted_count: 2,
        hidden_count: 0,
        metadata_only_count: 0,
        executable_count: 2,
        archived_count: 0,
        skill_install_fetched_count: 1,
        skill_install_upserted_count: 1,
        skill_reinstalled_count: 0,
        skill_failed_count: 0,
        disabled_skill_count: 0,
        archived_assistant_count: 0,
      },
    } as unknown)

    const result = await repairLocalSystemAssetIndexFromCloud({ reinstallMissing: true })

    expect(result?.vector_dimension).toBe(1536)
    expect(result?.skill_reindexed_count).toBe(3)
    expect(mockInvoke).toHaveBeenCalledWith("repair_local_system_asset_index", {
      accessToken: "desktop-token",
      limit: 500,
      reinstallMissing: true,
    })
  })

  it("returns null when repair fails in try helper", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {})
    mockInvoke.mockRejectedValue(new Error("boom"))

    const result = await tryRepairLocalSystemAssetIndexFromCloud()

    expect(result).toBeNull()
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})
