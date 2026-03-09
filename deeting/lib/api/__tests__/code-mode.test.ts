import {
  executeLocalCodeMode,
  fetchCodeModeExecution,
  fetchCodeModeExecutions,
  getLocalCodeModeBridgeStatus,
  replayCodeModeExecution,
} from "@/lib/api/code-mode"
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

describe("code mode api", () => {
  afterEach(() => {
    mockRequest.mockReset()
    mockInvoke.mockReset()
    process.env.NEXT_PUBLIC_IS_TAURI = originalTauriFlag
    delete windowWithTauri.__TAURI__
    delete windowWithTauri.__TAURI_INTERNALS__
  })

  it("fetches executions via tauri command", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue({
      items: [
        {
          id: "1",
          execution_id: "exec-1",
          session_id: "sess-1",
          language: "python",
          status: "success",
          runtime_mode: "sandbox",
          duration_ms: 12,
          tool_call_count: 1,
          created_at: "2026-03-03T00:00:00Z",
        },
      ],
      next_page: null,
      previous_page: null,
    } as unknown)

    const page = await fetchCodeModeExecutions({ size: 20 })

    expect(page.items[0]?.execution_id).toBe("exec-1")
    expect(mockInvoke).toHaveBeenCalledWith("list_local_code_mode_executions", {
      query: {
        cursor: null,
        size: 20,
        status: null,
        session_id: null,
      },
    })
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("fetches execution detail via cloud api in web runtime", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "false"
    mockRequest.mockResolvedValue({
      id: "1",
      execution_id: "exec-1",
      user_id: "u-1",
      session_id: "s-1",
      language: "python",
      status: "success",
      runtime_context: {},
      tool_plan_results: {},
      runtime_tool_calls: {},
      render_blocks: {},
      runtime_mode: "sandbox",
      duration_ms: 20,
      request_meta: {},
      created_at: "2026-03-03T00:00:00Z",
    })

    const detail = await fetchCodeModeExecution("exec-1")

    expect(detail.execution_id).toBe("exec-1")
    expect(mockRequest).toHaveBeenCalledWith({
      url: "/api/v1/internal/code-mode/executions/exec-1",
      method: "GET",
    })
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it("replays execution via tauri command", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI_INTERNALS__ = {}
    mockInvoke.mockResolvedValue({ replay_of: "1", source_execution_id: "exec-1" } as unknown)

    const result = await replayCodeModeExecution("exec-1", { dry_run: true })

    expect((result as Record<string, unknown>).source_execution_id).toBe("exec-1")
    expect(mockInvoke).toHaveBeenCalledWith("replay_local_code_mode_execution", {
      executionIdentifier: "exec-1",
      payload: { dry_run: true },
    })
  })

  it("returns bridge status and executes local code in tauri", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke
      .mockResolvedValueOnce({ running: true, base_url: "http://127.0.0.1:31001" } as unknown)
      .mockResolvedValueOnce({
        success: true,
        status: "success",
        format_version: "code_mode.v1",
        runtime_protocol_version: "v1",
        session_id: "sess-1",
        bridge_endpoint: "http://127.0.0.1:31001",
        exit_code: 0,
        stdout: [],
        stderr: [],
        result: [],
        runtime_tool_calls: [],
        render_blocks: [],
        error_code: null,
        runtime_mode: "sandbox",
      } as unknown)

    const bridgeStatus = await getLocalCodeModeBridgeStatus()
    const runResult = await executeLocalCodeMode({ code: "deeting.log('ok')" })

    expect(bridgeStatus.running).toBe(true)
    expect(runResult.success).toBe(true)
    expect(mockInvoke).toHaveBeenNthCalledWith(1, "get_local_code_mode_bridge_status", undefined)
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "execute_local_code_mode", {
      payload: {
        code: "deeting.log('ok')",
        session_id: null,
        language: "python",
        execution_timeout: 30,
        dry_run: false,
        context: null,
        max_calls: 16,
      },
    })
  })
})
