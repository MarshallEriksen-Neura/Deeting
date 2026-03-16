import {
  LocalSkillRuntimeStatusSchema,
  fetchPluginMarket,
  installPlugin,
  uninstallPlugin,
} from "@/lib/api/plugin-market"
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

  it("merges local installed skill ids into plugin market items", async () => {
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === "list_local_installed_skill_ids") {
        return ["skill.alpha"]
      }
      return null
    })
    mockRequest.mockResolvedValue([
      {
        id: "skill.alpha",
        name: "Alpha Skill",
        description: "desc",
        version: "1.0.0",
        source_repo: "https://github.com/example/alpha",
        source_revision: "main",
        status: "active",
        installed: false,
      },
    ])

    const result = await fetchPluginMarket({ q: "alpha" })

    expect(result).toHaveLength(1)
    expect(result[0]?.installed).toBe(true)
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/api/v1/plugin-market/plugins",
        method: "GET",
        params: { q: "alpha" },
      })
    )
    expect(mockInvoke).toHaveBeenCalledWith("list_local_installed_skill_ids", undefined)
  })

  it("installs plugin locally via tauri command", async () => {
    mockInvoke.mockResolvedValue({
      skill_id: "skill.alpha",
      tool_count: 3,
      install_path: "/tmp/skill.alpha",
    })

    const result = await installPlugin(
      {
        id: "skill.alpha",
        source_repo: "https://github.com/example/alpha",
        source_revision: "main",
      },
      { alias: "alpha-local" }
    )

    expect(result.skill_id).toBe("skill.alpha")
    expect(mockInvoke).toHaveBeenCalledWith("install_skill_from_repo", {
      repoUrl: "https://github.com/example/alpha",
      revision: "main",
      alias: "alpha-local",
    })
  })

  it("uninstalls plugin locally via tauri command", async () => {
    mockInvoke.mockResolvedValue(null)

    await uninstallPlugin("skill.alpha")

    expect(mockInvoke).toHaveBeenCalledWith("uninstall_skill", {
      skillId: "skill.alpha",
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
