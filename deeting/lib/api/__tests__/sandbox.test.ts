import {
  getLocalSandboxInstallGuide,
  getLocalSandboxStatus,
  installLocalSandboxBoxlite,
  prepareLocalSandbox,
  rebuildLocalSandboxRuntime,
  repairLocalSandbox,
} from "@/lib/api/sandbox"
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

describe("sandbox api", () => {
  afterEach(() => {
    mockInvoke.mockReset()
    process.env.NEXT_PUBLIC_IS_TAURI = originalTauriFlag
    delete windowWithTauri.__TAURI__
    delete windowWithTauri.__TAURI_INTERNALS__
  })

  it("returns unsupported sandbox state outside tauri runtime", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "false"

    const result = await getLocalSandboxStatus()

    expect(result.status).toBe("unsupported")
    expect(result.runtime_mode).toBe("disabled")
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it("parses needs_boxlite readiness reports", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValueOnce({
      platform: "windows",
      platform_supported: true,
      status: "needs_boxlite",
      provider_name: "host-python",
      runtime_mode: "host_fallback",
      wsl: { installed: true, ready: true },
      boxlite: {
        binary_found: false,
        binary_path: null,
        endpoint: "http://127.0.0.1:4318",
        reachable: false,
        managed_by_deeting: true,
      },
      execution_probe: {
        status: "skipped",
        detail: "Sandbox is not ready yet.",
        checked_at_unix_ms: null,
      },
      blocking_reason: "BoxLite is not installed in WSL for the Deeting sandbox yet.",
      next_actions: ["Install BoxLite from Desktop Sandbox settings"],
      can_auto_prepare: false,
    } as unknown)

    const result = await getLocalSandboxStatus()

    expect(result.status).toBe("needs_boxlite")
    expect(result.boxlite.binary_found).toBe(false)
  })

  it("calls tauri sandbox commands when desktop runtime is active", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke
      .mockResolvedValueOnce({
        platform: "windows",
        platform_supported: true,
        status: "ready",
        provider_name: "boxlite",
        runtime_mode: "sandbox",
        wsl: { installed: true, ready: true },
        boxlite: {
          binary_found: true,
          binary_path: "C:/Users/test/.deeting/sandbox/boxlite.exe",
          endpoint: "http://127.0.0.1:4318",
          reachable: true,
          managed_by_deeting: true,
        },
        execution_probe: {
          status: "passed",
          detail: "Sandbox execution probe passed.",
          checked_at_unix_ms: 123,
        },
        blocking_reason: null,
        next_actions: [],
        can_auto_prepare: true,
      } as unknown)
      .mockResolvedValueOnce({
        platform: "windows",
        platform_supported: true,
        status: "repair_needed",
        provider_name: "host-python",
        runtime_mode: "host_fallback",
        wsl: { installed: true, ready: true },
        boxlite: {
          binary_found: true,
          binary_path: "/home/test/.deeting/sandbox/boxlite/cli/boxlite",
          endpoint: "http://127.0.0.1:4318",
          reachable: false,
          managed_by_deeting: true,
        },
        execution_probe: {
          status: "skipped",
          detail: "Sandbox execution probe skipped.",
          checked_at_unix_ms: 124,
        },
        blocking_reason: "BoxLite was installed in WSL, but the managed BoxLite server is still starting.",
        next_actions: ["Try Prepare"],
        can_auto_prepare: true,
      } as unknown)
      .mockResolvedValueOnce({
        platform: "windows",
        platform_supported: true,
        status: "repair_needed",
        provider_name: "host-python",
        runtime_mode: "host_fallback",
        wsl: { installed: true, ready: true },
        boxlite: {
          binary_found: true,
          binary_path: "C:/Users/test/.deeting/sandbox/boxlite.exe",
          endpoint: "http://127.0.0.1:4318",
          reachable: false,
          managed_by_deeting: true,
        },
        execution_probe: {
          status: "skipped",
          detail: "Sandbox execution probe skipped.",
          checked_at_unix_ms: 125,
        },
        blocking_reason: "BoxLite is installed but not reachable.",
        next_actions: ["Try Prepare"],
        can_auto_prepare: true,
      } as unknown)
      .mockResolvedValueOnce({
        platform: "windows",
        platform_supported: true,
        status: "ready",
        provider_name: "boxlite",
        runtime_mode: "sandbox",
        wsl: { installed: true, ready: true },
        boxlite: {
          binary_found: true,
          binary_path: "C:/Users/test/.deeting/sandbox/boxlite.exe",
          endpoint: "http://127.0.0.1:4318",
          reachable: true,
          managed_by_deeting: true,
        },
        execution_probe: {
          status: "passed",
          detail: "Sandbox execution probe passed.",
          checked_at_unix_ms: 126,
        },
        blocking_reason: null,
        next_actions: [],
        can_auto_prepare: true,
      } as unknown)
      .mockResolvedValueOnce({
        platform: "windows",
        platform_supported: true,
        status: "ready",
        provider_name: "boxlite",
        runtime_mode: "sandbox",
        wsl: { installed: true, ready: true },
        boxlite: {
          binary_found: true,
          binary_path: "C:/Users/test/.deeting/sandbox/boxlite.exe",
          endpoint: "http://127.0.0.1:4318",
          reachable: true,
          managed_by_deeting: true,
        },
        execution_probe: {
          status: "passed",
          detail: "Sandbox execution probe passed.",
          checked_at_unix_ms: 127,
        },
        blocking_reason: null,
        next_actions: [],
        can_auto_prepare: true,
      } as unknown)
      .mockResolvedValueOnce({
        status: "needs_wsl",
        title: "Install Windows Subsystem for Linux",
        description: "WSL is required before the sandbox can start.",
        steps: ["Run wsl --install"],
        primary_command: "wsl --install",
      } as unknown)

    const status = await getLocalSandboxStatus()
    const installed = await installLocalSandboxBoxlite()
    const prepared = await prepareLocalSandbox()
    const repaired = await repairLocalSandbox()
    const rebuilt = await rebuildLocalSandboxRuntime()
    const guide = await getLocalSandboxInstallGuide()

    expect(status.provider_name).toBe("boxlite")
    expect(installed.status).toBe("repair_needed")
    expect(prepared.status).toBe("repair_needed")
    expect(repaired.runtime_mode).toBe("sandbox")
    expect(rebuilt.runtime_mode).toBe("sandbox")
    expect(guide.primary_command).toBe("wsl --install")
    expect(mockInvoke).toHaveBeenNthCalledWith(1, "get_local_sandbox_status", undefined)
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "install_local_sandbox_boxlite", undefined)
    expect(mockInvoke).toHaveBeenNthCalledWith(3, "prepare_local_sandbox", undefined)
    expect(mockInvoke).toHaveBeenNthCalledWith(4, "repair_local_sandbox", undefined)
    expect(mockInvoke).toHaveBeenNthCalledWith(5, "rebuild_local_sandbox_runtime", undefined)
    expect(mockInvoke).toHaveBeenNthCalledWith(6, "get_local_sandbox_install_guide", undefined)
  })
})
