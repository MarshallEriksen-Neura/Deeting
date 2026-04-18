import { invoke } from "@tauri-apps/api/core"
import {
  DESKTOP_MCP_COMMANDS,
  recoverDesktopLocalChatExecution,
  rejectDesktopTool,
  streamDesktopApproveTool,
} from "@/lib/api/mcp-desktop"
import { resolveLocalGatewayBaseUrl } from "@/lib/api/chat"
import { openSSE, request } from "@/lib/http"

jest.mock("@tauri-apps/api/core", () => ({
  invoke: jest.fn(),
}))

jest.mock("@/lib/api/chat", () => ({
  resolveLocalGatewayBaseUrl: jest.fn(),
}))

jest.mock("@/lib/http", () => ({
  openSSE: jest.fn(),
  request: jest.fn(),
}))

const mockResolveLocalGatewayBaseUrl =
  resolveLocalGatewayBaseUrl as jest.MockedFunction<typeof resolveLocalGatewayBaseUrl>
const mockOpenSSE = openSSE as jest.MockedFunction<typeof openSSE>
const mockRequest = request as jest.MockedFunction<typeof request>
const mockInvoke = invoke as jest.MockedFunction<typeof invoke>

describe("mcp desktop gateway approval helpers", () => {
  beforeEach(() => {
    mockResolveLocalGatewayBaseUrl.mockResolvedValue("http://127.0.0.1:4317")
  })

  afterEach(() => {
    mockResolveLocalGatewayBaseUrl.mockReset()
    mockOpenSSE.mockReset()
    mockRequest.mockReset()
    mockInvoke.mockReset()
  })

  it("streams desktop approval over the local gateway SSE endpoint", async () => {
    const finalPayload = {
      status: "LOCAL_CHAT_RESUMED",
      approved_tool_result: { ok: true },
    }
    const continuationEvent = {
      type: "blocks",
      blocks: [{ id: "resume-1", type: "text", content: "continued" }],
    }

    mockOpenSSE.mockImplementation((_url, options) => {
      options.onMessage({ data: { type: "status", code: "approval.executing" } })
      options.onMessage({ data: continuationEvent })
      options.onMessage({ data: finalPayload })
      options.onMessage({ data: "[DONE]" })
      return () => {}
    })

    const onMessage = jest.fn()
    const result = await streamDesktopApproveTool(
      {
        approvalToken: "approval-1",
        approvalMode: "allow_once",
        callId: "call-1",
        executionToken: "exec-1",
        executionGraphExecutionId: "graph-1",
      },
      { onMessage }
    )

    expect(mockOpenSSE).toHaveBeenCalledWith(
      "http://127.0.0.1:4317/v1/mcp/tool-approvals/approve",
      expect.objectContaining({
        method: "POST",
        includeAuthHeader: false,
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
      })
    )
    expect(onMessage).toHaveBeenCalledWith({ type: "status", code: "approval.executing" })
    expect(onMessage).toHaveBeenCalledWith(continuationEvent)
    expect(result).toEqual(finalPayload)
  })

  it("dedupes concurrent desktop approval streams by approval token", async () => {
    let resolveFirst!: (value: unknown) => void

    mockOpenSSE.mockImplementation((_url, options) => {
      queueMicrotask(() => {
        options.onMessage({ data: { type: "status", code: "approval.executing" } })
      })
      resolveFirst = (value) => {
        options.onMessage({ data: value })
        options.onMessage({ data: "[DONE]" })
      }
      return () => {}
    })

    const firstPromise = streamDesktopApproveTool({
      approvalToken: "approval-dedupe-1",
      approvalMode: "allow_once",
    })
    const secondPromise = streamDesktopApproveTool({
      approvalToken: "approval-dedupe-1",
      approvalMode: "allow_once",
    })

    await Promise.resolve()
    expect(mockOpenSSE).toHaveBeenCalledTimes(1)

    const finalPayload = {
      status: "LOCAL_CHAT_RESUMED",
      approved_tool_result: { ok: true },
    }
    resolveFirst(finalPayload)

    await expect(firstPromise).resolves.toEqual(finalPayload)
    await expect(secondPromise).resolves.toEqual(finalPayload)
    expect(mockOpenSSE).toHaveBeenCalledTimes(1)
  })

  it("rejects the promise when the approval SSE stream emits a typed error event", async () => {
    mockOpenSSE.mockImplementation((_url, options) => {
      options.onMessage({
        data: {
          type: "error",
          message: "approval failed",
          error_code: "LOCAL_TOOL_APPROVAL_FAILED",
        },
      })
      return () => {}
    })

    await expect(
      streamDesktopApproveTool({
        approvalToken: "approval-2",
      })
    ).rejects.toThrow("approval failed")
  })

  it("posts desktop rejection over the local gateway HTTP endpoint", async () => {
    mockRequest.mockResolvedValue({ status: "LOCAL_CHAT_REJECTED" } as never)

    await rejectDesktopTool({
      approvalToken: "approval-3",
      rejectMode: "deny_always",
      executionGraphExecutionId: "graph-3",
    })

    expect(mockRequest).toHaveBeenCalledWith({
      url: "http://127.0.0.1:4317/v1/mcp/tool-approvals/reject",
      method: "POST",
      data: {
        approval_token: "approval-3",
        reject_mode: "deny_always",
        execution_graph_execution_id: "graph-3",
      },
      anonymous: true,
    })
  })

  it("invokes the desktop recovery command for canonical local chat recovery", async () => {
    mockInvoke.mockResolvedValue({ status: "LOCAL_CHAT_RESUMED" } as never)

    await recoverDesktopLocalChatExecution({
      executionGraphExecutionId: "graph-recovery-1",
      action: "retry",
    })

    expect(mockInvoke).toHaveBeenCalledWith(
      DESKTOP_MCP_COMMANDS.recoverLocalChatExecution,
      {
        executionGraphExecutionId: "graph-recovery-1",
        action: "retry",
      }
    )
  })
})
