import {
  getLocalCapabilityRegistryDiagnostics,
  listLocalMaintenanceLogs,
  runLocalMaintenanceAction,
} from "@/lib/api/desktop-system-assets"
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

describe("desktop system assets api", () => {
  afterEach(() => {
    mockInvoke.mockReset()
    process.env.NEXT_PUBLIC_IS_TAURI = originalTauriFlag
    delete windowWithTauri.__TAURI__
    delete windowWithTauri.__TAURI_INTERNALS__
  })

  it("runs local maintenance action through tauri wrapper", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue({
      id: "log-1",
      kind: "repair_local_index",
      status: "success",
      message: "ok",
      details: {
        vector_dimension: 1536,
        core_registry_count: 4,
        mcp_registry_count: 2,
        assistant_registry_count: 3,
        skill_reindexed_count: 1,
        mcp_tool_reindexed_count: 2,
        assistant_reindexed_count: 2,
        knowledge_reindexed_count: 5,
      },
      created_at: "2026-03-11T00:00:00Z",
    } as unknown)

    const result = await runLocalMaintenanceAction({ kind: "repair_local_index" })

    expect(result?.status).toBe("success")
    expect(mockInvoke).toHaveBeenCalledWith("run_local_maintenance_action", {
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
      cache_status: {
        current_epoch: 7,
        cache_present: true,
        cache_ttl_ms: 15000,
        cache_age_ms: 120,
        last_build_epoch: 7,
        last_invalidation_epoch: 6,
        last_invalidation_reason: "replace_local_capability_registry_entries",
        cache_hit_count: 4,
        cache_miss_count: 2,
        build_count: 2,
      },
      items: [],
    } as unknown)

    const result = await getLocalCapabilityRegistryDiagnostics()

    expect(result?.read_path_mode).toBe("registry_first")
    expect(result?.legacy_only_assets).toHaveLength(1)
    expect(result?.cache_status?.cache_present).toBe(true)
    expect(mockInvoke).toHaveBeenCalledWith("get_local_capability_registry_diagnostics", undefined)
  })
})
