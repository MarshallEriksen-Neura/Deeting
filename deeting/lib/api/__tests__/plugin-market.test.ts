import {
  LocalSkillRuntimeStatusSchema,
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
          assistant_fetched_count: 0,
          skill_fetched_count: 1,
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
          assistant_fetched_count: 0,
          skill_fetched_count: 0,
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

  it("parses local skill runtime status with normalized execution fields", () => {
    const parsed = LocalSkillRuntimeStatusSchema.parse({
      skill_id: "skill.openclaw_weather",
      display_name: "OpenClaw Weather",
      installed_version: "1.0.0",
      is_enabled: true,
      execution_mode: "script_guidance",
      ecosystem: "openclaw_agentskills",
      adapter_kind: "openclaw_script",
      normalized_execution_surface: "script_runner",
      runnable_now: false,
      required_bins: ["python3"],
      missing_bins: [],
      required_env: [{ key: "OPENWEATHER_API_KEY", configured: false }],
      missing_env: ["OPENWEATHER_API_KEY"],
      required_config: [],
      missing_config: [],
      blocking_reason: "script_runner",
      install_hints: ["pip install -r requirements.txt"],
      runtime_install_supported: true,
      runtime_kind: "python",
      runtime_install_state: "needs_install",
      runtime_install_manager: "uv",
      runtime_manager_available: true,
      runtime_install_error: null,
      runtime_dependency_manifest_path: "/tmp/openclaw-weather/requirements.txt",
      runtime_command_path: null,
      compatibility: {},
      current_env: {},
      current_config: {},
    })

    expect(parsed.adapter_kind).toBe("openclaw_script")
    expect(parsed.normalized_execution_surface).toBe("script_runner")
    expect(parsed.blocking_reason).toBe("script_runner")
    expect(parsed.runtime_install_manager).toBe("uv")
  })
})
