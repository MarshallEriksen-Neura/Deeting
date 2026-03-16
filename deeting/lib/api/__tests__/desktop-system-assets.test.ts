import {
  getLocalCapabilityRegistryDiagnostics,
  listLocalMaintenanceLogs,
  repairLocalSystemAssetIndexFromCloud,
  runLocalMaintenanceAction,
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

  it("runs local maintenance action through tauri wrapper", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue({
      id: "log-1",
      kind: "repair_local_index",
      status: "success",
      message: "ok",
      details: { assistant_reindexed_count: 2 },
      created_at: "2026-03-11T00:00:00Z",
    } as unknown)

    const result = await runLocalMaintenanceAction({ kind: "repair_local_index" })

    expect(result?.status).toBe("success")
    expect(mockInvoke).toHaveBeenCalledWith("run_local_maintenance_action", {
      accessToken: "desktop-token",
      request: {
        kind: "repair_local_index",
        limit: 500,
        reinstallMissing: false,
      },
    })
  })

  it("lists local maintenance logs", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue({ total: 1, skip: 0, limit: 10, items: [] } as unknown)

    const result = await listLocalMaintenanceLogs({ limit: 10 })

    expect(result?.total).toBe(1)
    expect(mockInvoke).toHaveBeenCalledWith("list_local_maintenance_logs", {
      query: {
        limit: 10,
        skip: 0,
        kind: undefined,
        status: undefined,
      },
    })
  })

  it("loads local capability registry diagnostics", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue({
      read_path_enabled: true,
      read_path_mode: "registry_first",
      legacy_control_plane_reads_enabled: false,
      current_generation: 5,
      total: 8,
      direct_callable_count: 4,
      source_kind_counts: [],
      memory_source_type_counts: [],
      asset_kind_counts: [],
      activation_state_counts: [],
      runtime_state_counts: [],
      search_index_state_counts: [],
      legacy_only_asset_count: 1,
      registry_first_only_asset_count: 0,
      migration_gaps: ["mcp"],
      legacy_only_assets: [
        {
          key: "skill_tool:skill.alpha::install",
          asset_id: "skill_binding::skill.alpha::install",
          name: "skill.skill.alpha.install",
          source_type: "user",
          asset_type: "skill_tool",
          package_id: "skill.alpha",
        },
      ],
      registry_first_only_assets: [],
      items: [],
    } as unknown)

    const result = await getLocalCapabilityRegistryDiagnostics()

    expect(result?.read_path_mode).toBe("registry_first")
    expect(result?.legacy_only_assets).toHaveLength(1)
    expect(mockInvoke).toHaveBeenCalledWith("get_local_capability_registry_diagnostics")
  })
})
