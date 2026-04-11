"use client"

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { ToolApprovalDialog } from "@/components/bridge/tool-approval-dialog"
import {
  createBridgeToolApproval,
  useBridgeApprovalStore,
} from "@/lib/chat/bridge-approval-store"
import { bridgeCallTool } from "@/lib/api/bridge"
import { listPendingMcpApprovals } from "@/lib/api/mcp-approvals"
import { rejectDesktopTool, streamDesktopApproveTool } from "@/lib/api/mcp-desktop"
import { useChatStore } from "@/store/chat-store"
import type { MessageBlock } from "@/lib/chat/message-protocol"

jest.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => {
    const messages: Record<string, string> = {
      "chat.approvalDialog.actions.approveOnce": "actions.approveOnce",
      "chat.approvalDialog.actions.denyAlways": "actions.denyAlways",
      "chat.approvalDialog.toast.approvedPending": "toast.approvedPending",
      "chat.approvalDialog.toast.approvedAlwaysPending": "toast.approvedAlwaysPending",
      "chat.approvalDialog.toast.approved": "toast.approved",
      "chat.approvalDialog.toast.executionFailed": "toast.executionFailed:{message}",
      "chat.approvalDialog.toast.deniedAlways": "toast.deniedAlways",
      "chat.approvalDialog.result.userDeniedAlways": "result.userDeniedAlways",
      "chat.approvalDialog.queueItemSourceFallback": "queueItemSourceFallback",
      "chat.approvalDialog.queueItemSourceBound": "queueItemSourceBound",
      "chat.approvalDialog.queueItemSource": "queueItemSource:{source}",
      "chat.approvalDialog.queuePreviewLabel": "queuePreviewLabel",
      "chat.approvalDialog.queueStatus": "queueStatus:{current}/{total}",
      "chat.approvalDialog.queueRemaining": "queueRemaining:{count}",
      "chat.approvalDialog.queueCurrentStatus": "queueCurrentStatus",
    }

    return (key: string, values?: Record<string, string | number>) => {
      const template = messages[namespace ? `${namespace}.${key}` : key] ?? key
      return Object.entries(values ?? {}).reduce(
        (result, [name, value]) => result.replace(`{${name}}`, String(value)),
        template
      )
    }
  },
}))

jest.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  AlertDialogAction: ({
    children,
    onClick,
    disabled,
  }: React.PropsWithChildren<{
    onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void
    disabled?: boolean
  }>) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  AlertDialogCancel: ({
    children,
    onClick,
    disabled,
  }: React.PropsWithChildren<{
    onClick?: () => void
    disabled?: boolean
  }>) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  AlertDialogContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: React.PropsWithChildren) => <>{children}</>,
  AlertDialogFooter: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}))

jest.mock("@/lib/api/mcp-desktop", () => ({
  streamDesktopApproveTool: jest.fn(),
  rejectDesktopTool: jest.fn(),
}))

jest.mock("@/lib/api/bridge", () => ({
  bridgeCallTool: jest.fn(),
}))

jest.mock("@/lib/api/mcp-approvals", () => ({
  listPendingMcpApprovals: jest.fn(),
}))

const mockApproveTool = streamDesktopApproveTool as jest.MockedFunction<
  typeof streamDesktopApproveTool
>
const mockRejectTool = rejectDesktopTool as jest.MockedFunction<typeof rejectDesktopTool>
const mockBridgeCallTool = bridgeCallTool as jest.MockedFunction<typeof bridgeCallTool>
const mockListPendingMcpApprovals =
  listPendingMcpApprovals as jest.MockedFunction<typeof listPendingMcpApprovals>

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe("ToolApprovalDialog", () => {
  afterEach(() => {
    mockApproveTool.mockReset()
    mockRejectTool.mockReset()
    mockBridgeCallTool.mockReset()
    mockListPendingMcpApprovals.mockReset()
    jest.clearAllMocks()
    act(() => {
      useBridgeApprovalStore.getState().clearAll()
      useBridgeApprovalStore.getState().clearRecentApprovedExecution()
      useChatStore.getState().resetSession()
    })
  })

  it("uses the local gateway approval stream and reports bridge results back", async () => {
    mockApproveTool.mockResolvedValueOnce({ ok: true } as unknown)
    mockBridgeCallTool.mockResolvedValueOnce({ ok: true } as never)

    act(() => {
      useBridgeApprovalStore.getState().setPending(
        createBridgeToolApproval({
          approval_token: "approval-1",
          tool_name: "write_file",
          arguments: { path: "demo.txt" },
          meta: {
            call_id: "call-1",
            execution_token: "exec-1",
          },
        })
      )
    })

    render(<ToolApprovalDialog />)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "actions.approveOnce" }))
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(mockApproveTool).toHaveBeenCalledWith(
        {
          approvalToken: "approval-1",
          approvalMode: "allow_once",
          callId: "call-1",
          executionToken: "exec-1",
          executionGraphExecutionId: undefined,
        },
        expect.objectContaining({
          onMessage: expect.any(Function),
        })
      )
    })

    expect(mockBridgeCallTool).toHaveBeenCalledWith({
      tool_name: "write_file",
      arguments: {
        call_id: "call-1",
        result: { ok: true },
        ok: true,
      },
      execution_token: "exec-1",
    })
    expect(useBridgeApprovalStore.getState().pending).toBeNull()
  })

  it("uses the local gateway reject request for deny always", async () => {
    mockRejectTool.mockResolvedValueOnce({
      status: "LOCAL_CHAT_REJECTED",
      execution_graph_execution_id: "graph-exec-deny-1",
    } as never)
    mockBridgeCallTool.mockResolvedValueOnce({ ok: true } as never)

    act(() => {
      useBridgeApprovalStore.getState().setPending(
        createBridgeToolApproval({
          approval_token: "approval-3",
          tool_name: "write_file",
          arguments: { path: "demo.txt" },
          meta: {
            call_id: "call-3",
            execution_token: "exec-3",
            execution_graph_execution_id: "graph-exec-deny-1",
          },
        })
      )
    })

    render(<ToolApprovalDialog />)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "actions.denyAlways" }))
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(mockRejectTool).toHaveBeenCalledWith({
        approvalToken: "approval-3",
        rejectMode: "deny_always",
        executionGraphExecutionId: "graph-exec-deny-1",
      })
    })

    expect(mockBridgeCallTool).toHaveBeenCalledWith({
      tool_name: "write_file",
      arguments: {
        call_id: "call-3",
        result: { error: "result.userDeniedAlways" },
        ok: false,
      },
      execution_token: "exec-3",
    })
  })

  it("writes approved local-chat results back into the matching assistant message", async () => {
    mockApproveTool.mockResolvedValueOnce({
      status: "LOCAL_CHAT_RESUMED",
      approved_tool_result: { crawled_pages: 3 },
      continuation_blocks: [{ id: "resume-text-1", type: "text", content: "Finished crawl." }],
      execution_graph_execution_id: "graph-exec-local-1",
      execution_graph: {
        execution_id: "graph-exec-local-1",
      },
    } as unknown)

    act(() => {
      useChatStore.setState({
        messages: [
          {
            id: "assistant-local-1",
            role: "assistant",
            content: "",
            createdAt: 1,
            blocks: [
              {
                id: "call-local-1",
                type: "tool_call",
                callId: "call-local-1",
                toolName: "skill.official.skills.crawler.crawl_website",
                status: "running",
              } as MessageBlock,
              {
                id: "result-local-1",
                type: "tool_result",
                callId: "call-local-1",
                toolName: "skill.official.skills.crawler.crawl_website",
                status: "success",
                result: {
                  status: "REQUIRES_APPROVAL",
                  approval_token: "approval-local-1",
                  execution_graph_execution_id: "graph-exec-local-1",
                  execution_graph_gate_node_id: "approval_gate:call-local-1",
                  execution_graph_tool_node_id: "tool_call:call-local-1",
                },
              } as MessageBlock,
            ],
          },
        ],
      })
      useBridgeApprovalStore.getState().setPending(
        createBridgeToolApproval({
          approval_token: "approval-local-1",
          tool_name: "skill.official.skills.crawler.crawl_website",
          arguments: { url: "https://example.com" },
          meta: {
            call_id: "call-local-1",
            message_id: "assistant-local-1",
            execution_graph_execution_id: "graph-exec-local-1",
            execution_graph_gate_node_id: "approval_gate:call-local-1",
            execution_graph_tool_node_id: "tool_call:call-local-1",
          },
        })
      )
    })

    render(<ToolApprovalDialog />)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "actions.approveOnce" }))
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(mockApproveTool).toHaveBeenCalledWith(
        {
          approvalToken: "approval-local-1",
          approvalMode: "allow_once",
          callId: "call-local-1",
          executionToken: undefined,
          executionGraphExecutionId: "graph-exec-local-1",
        },
        expect.objectContaining({
          onMessage: expect.any(Function),
        })
      )
    })

    expect(useChatStore.getState().messages[0]?.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool_result",
          callId: "call-local-1",
          status: "success",
          result: {
            crawled_pages: 3,
            execution_graph_execution_id: "graph-exec-local-1",
            execution_graph_gate_node_id: "approval_gate:call-local-1",
            execution_graph_tool_node_id: "tool_call:call-local-1",
          },
        }),
        expect.objectContaining({
          type: "text",
          content: "Finished crawl.",
        }),
      ])
    )
  })

  it("preserves tool error payloads and appends the resume error block when continuation fails", async () => {
    mockApproveTool.mockResolvedValueOnce({
      status: "LOCAL_CHAT_RESUME_FAILED",
      approved_tool_result: {
        content: [
          {
            text: "Error: Invalid arguments for search_notes",
            type: "text",
          },
        ],
        isError: true,
      },
      continuation_blocks: [],
      error: "upstream error: do request failed",
      execution_graph_execution_id: "graph-exec-failed-1",
      execution_graph: {
        execution_id: "graph-exec-failed-1",
      },
    } as unknown)

    act(() => {
      useChatStore.setState({
        messages: [
          {
            id: "assistant-failed-1",
            role: "assistant",
            content: "",
            createdAt: 1,
            blocks: [
              {
                id: "call-failed-1",
                type: "tool_call",
                callId: "call-failed-1",
                toolName: "search_notes",
                status: "running",
              } as MessageBlock,
              {
                id: "result-failed-1",
                type: "tool_result",
                callId: "call-failed-1",
                toolName: "search_notes",
                status: "success",
                result: {
                  status: "REQUIRES_APPROVAL",
                  approval_token: "approval-failed-1",
                  execution_graph_execution_id: "graph-exec-failed-1",
                  execution_graph_gate_node_id: "approval_gate:call-failed-1",
                  execution_graph_tool_node_id: "tool_call:call-failed-1",
                },
              } as MessageBlock,
            ],
          },
        ],
      })
      useBridgeApprovalStore.getState().setPending(
        createBridgeToolApproval({
          approval_token: "approval-failed-1",
          tool_name: "search_notes",
          arguments: {},
          meta: {
            call_id: "call-failed-1",
            message_id: "assistant-failed-1",
            execution_graph_execution_id: "graph-exec-failed-1",
            execution_graph_gate_node_id: "approval_gate:call-failed-1",
            execution_graph_tool_node_id: "tool_call:call-failed-1",
          },
        })
      )
    })

    render(<ToolApprovalDialog />)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "actions.approveOnce" }))
      await Promise.resolve()
    })

    const blocks = useChatStore.getState().messages[0]?.blocks ?? []
    expect(blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool_result",
          callId: "call-failed-1",
          status: "success",
          result: expect.objectContaining({
            isError: true,
            execution_graph_execution_id: "graph-exec-failed-1",
          }),
        }),
        expect.objectContaining({
          type: "error",
          message: "upstream error: do request failed",
        }),
      ])
    )
  })

  it("applies streamed approval continuation blocks immediately and avoids duplicating them from the final payload", async () => {
    mockApproveTool.mockImplementationOnce(async (_payload, handlers) => {
      handlers?.onMessage?.({
        type: "blocks",
        blocks: [{ id: "resume-stream-1", type: "text", content: "Streamed continuation." }],
      })
      return {
        status: "LOCAL_CHAT_RESUMED",
        approved_tool_result: { ok: true },
        continuation_blocks: [
          { id: "resume-stream-1", type: "text", content: "Streamed continuation." },
        ],
      }
    })

    act(() => {
      useChatStore.setState({
        messages: [
          {
            id: "assistant-stream-1",
            role: "assistant",
            content: "",
            createdAt: 1,
            blocks: [
              {
                id: "call-stream-1",
                type: "tool_call",
                callId: "call-stream-1",
                toolName: "search_notes",
                status: "running",
              } as MessageBlock,
              {
                id: "result-stream-1",
                type: "tool_result",
                callId: "call-stream-1",
                toolName: "search_notes",
                status: "success",
                result: {
                  status: "REQUIRES_APPROVAL",
                  approval_token: "approval-stream-1",
                },
              } as MessageBlock,
            ],
          },
        ],
      })
      useBridgeApprovalStore.getState().setPending(
        createBridgeToolApproval({
          approval_token: "approval-stream-1",
          tool_name: "search_notes",
          arguments: {},
          meta: {
            call_id: "call-stream-1",
            message_id: "assistant-stream-1",
          },
        })
      )
    })

    render(<ToolApprovalDialog />)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "actions.approveOnce" }))
      await Promise.resolve()
    })

    const textBlocks = (useChatStore.getState().messages[0]?.blocks ?? []).filter(
      (block) => block.type === "text" && block.content === "Streamed continuation."
    )
    expect(textBlocks).toHaveLength(1)
  })

  it("refreshes canonical pending approvals after a local approval returns waiting_approval", async () => {
    mockApproveTool.mockResolvedValueOnce({
      status: "LOCAL_CHAT_WAITING_APPROVAL",
      approved_tool_result: { ok: true },
      continuation_blocks: [
        {
          id: "call-local-next-1",
          type: "tool_call",
          callId: "call-local-next-1",
          toolName: "browser_click",
          status: "running",
        },
        {
          id: "result-local-next-1",
          type: "tool_result",
          callId: "call-local-next-1",
          toolName: "browser_click",
          status: "requires_approval",
          result: {
            status: "REQUIRES_APPROVAL",
            approval_token: "approval-local-next-1",
            tool_name: "browser_click",
          },
        },
      ],
      execution_graph_execution_id: "graph-exec-waiting-1",
    } as unknown)
    mockListPendingMcpApprovals.mockResolvedValueOnce([
      {
        status: "REQUIRES_APPROVAL",
        approval_token: "approval-local-next-1",
        tool_name: "browser_click",
        arguments: { target: { text: "Continue" } },
        call_id: "call-local-next-1",
        session_id: "session-local-waiting-1",
        execution_graph_execution_id: "graph-exec-waiting-1",
      },
    ])

    act(() => {
      useChatStore.setState({
        sessionId: "session-local-waiting-1",
        messages: [
          {
            id: "assistant-local-waiting-1",
            role: "assistant",
            content: "",
            createdAt: 1,
            blocks: [
              {
                id: "call-local-waiting-1",
                type: "tool_call",
                callId: "call-local-waiting-1",
                toolName: "browser_open_tab",
                status: "running",
              } as MessageBlock,
              {
                id: "result-local-waiting-1",
                type: "tool_result",
                callId: "call-local-waiting-1",
                toolName: "browser_open_tab",
                status: "requires_approval",
                result: {
                  status: "REQUIRES_APPROVAL",
                  approval_token: "approval-local-waiting-1",
                  execution_graph_execution_id: "graph-exec-waiting-1",
                },
              } as MessageBlock,
            ],
          },
        ],
      })
      useBridgeApprovalStore.getState().setPending(
        createBridgeToolApproval({
          approval_token: "approval-local-waiting-1",
          tool_name: "browser_open_tab",
          arguments: { url: "https://example.com" },
          meta: {
            call_id: "call-local-waiting-1",
            message_id: "assistant-local-waiting-1",
            execution_graph_execution_id: "graph-exec-waiting-1",
          },
        })
      )
    })

    render(<ToolApprovalDialog />)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "actions.approveOnce" }))
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(mockListPendingMcpApprovals).toHaveBeenCalledWith("session-local-waiting-1")
    })

    await waitFor(() => {
      expect(useBridgeApprovalStore.getState().pending).toMatchObject({
        approval_token: "approval-local-next-1",
        tool_name: "browser_click",
        arguments: { target: { text: "Continue" } },
        meta: {
          call_id: "call-local-next-1",
          message_id: "assistant-local-waiting-1",
          execution_graph_execution_id: "graph-exec-waiting-1",
        },
      })
    })

    expect(useBridgeApprovalStore.getState().queue).toHaveLength(1)
  })

  it("replaces stale approval status with execution and then clears it after approval completes", async () => {
    const deferred = createDeferred<unknown>()
    mockApproveTool.mockImplementationOnce(async () => deferred.promise)

    act(() => {
      useChatStore.setState({
        statusStage: "render",
        statusCode: "approval.required",
        statusMeta: {
          tool_name: "search_notes",
          call_id: "call-status-1",
        },
        messages: [
          {
            id: "assistant-status-1",
            role: "assistant",
            content: "",
            createdAt: 1,
            blocks: [
              {
                id: "call-status-1",
                type: "tool_call",
                callId: "call-status-1",
                toolName: "search_notes",
                status: "success",
              } as MessageBlock,
              {
                id: "result-status-1",
                type: "tool_result",
                callId: "call-status-1",
                toolName: "search_notes",
                status: "requires_approval",
                result: {
                  status: "REQUIRES_APPROVAL",
                  approval_token: "approval-status-1",
                },
              } as MessageBlock,
            ],
          },
        ],
      })
      useBridgeApprovalStore.getState().setPending(
        createBridgeToolApproval({
          approval_token: "approval-status-1",
          tool_name: "search_notes",
          arguments: {},
          meta: {
            call_id: "call-status-1",
            message_id: "assistant-status-1",
          },
        })
      )
    })

    render(<ToolApprovalDialog />)

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "actions.approveOnce" }))
      await Promise.resolve()
    })

    expect(useChatStore.getState().statusStage).toBe("render")
    expect(useChatStore.getState().statusCode).toBe("approval.executing")

    await act(async () => {
      deferred.resolve({
        status: "LOCAL_CHAT_RESUMED",
        approved_tool_result: { ok: true },
        continuation_blocks: [
          {
            id: "exec-status-ui-1",
            type: "ui",
            viewType: "execution.lifecycle",
            payload: {
              schema_version: 1,
              root_execution_id: "exec-root-status-1",
              execution_id: "exec-root-status-1",
              execution_kind: "workflow",
              execution_status: "integrated",
            },
          },
          {
            id: "resume-status-text-1",
            type: "text",
            content: "Done.",
          },
        ],
      })
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(useChatStore.getState().statusStage).toBeNull()
      expect(useChatStore.getState().statusCode).toBeNull()
      expect(useChatStore.getState().statusMeta).toBeNull()
    })
  })

  it("uses assistant blocks instead of legacy assistant content for queued source previews", () => {
    act(() => {
      useChatStore.setState({
        messages: [
          {
            id: "assistant-preview-1",
            role: "assistant",
            content: "Legacy only content",
            createdAt: 1,
            blocks: [],
          },
        ],
      })
      useBridgeApprovalStore.getState().setPending(
        createBridgeToolApproval({
          approval_token: "approval-preview-1",
          tool_name: "search_notes",
          arguments: {},
          meta: {
            call_id: "call-preview-1",
            message_id: "assistant-preview-1",
          },
        })
      )
      useBridgeApprovalStore.getState().enqueuePending(
        createBridgeToolApproval({
          approval_token: "approval-preview-2",
          tool_name: "browser_open_tab",
          arguments: { url: "https://example.com" },
          meta: {
            call_id: "call-preview-2",
            message_id: "assistant-preview-1",
          },
        })
      )
    })

    render(<ToolApprovalDialog />)

    expect(screen.getByText("queueItemSource:queueItemSourceBound")).toBeInTheDocument()
    expect(screen.queryByText(/Legacy only content/)).not.toBeInTheDocument()
  })
})
