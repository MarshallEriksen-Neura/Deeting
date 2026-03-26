"use client"

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { ToolApprovalDialog } from "@/components/bridge/tool-approval-dialog"
import {
  createBridgeToolApproval,
  useBridgeApprovalStore,
} from "@/lib/chat/bridge-approval-store"
import { createBridgeToolApproval as createBrowserAwareApproval } from "@/lib/chat/tool-approval"
import { invoke } from "@tauri-apps/api/core"
import { bridgeCallTool } from "@/lib/api/bridge"
import { toast } from "sonner"
import { useChatStore } from "@/store/chat-store"
import type { MessageBlock } from "@/lib/chat/message-protocol"

jest.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => {
    const messages: Record<string, string> = {
      "chat.approvalDialog.title": "审批确认",
      "chat.approvalDialog.description": "当前 AI 正请求在本地执行一个高风险工具。",
      "chat.approvalDialog.toolLabel": "工具",
      "chat.approvalDialog.argumentsLabel": "参数",
      "chat.approvalDialog.summaryLabel": "说明",
      "chat.approvalDialog.warningTitle": "执行前请确认",
      "chat.approvalDialog.warning":
        "该操作可能修改文件或执行系统命令，仅在你信任当前会话时才允许。",
      "chat.approvalDialog.actions.reject": "拒绝",
      "chat.approvalDialog.actions.approve": "批准执行",
      "chat.approvalDialog.actions.approving": "执行中...",
      "chat.approvalDialog.badges.approved": "已批准",
      "chat.approvalDialog.toast.approvedPending": "已批准，正在执行 {toolName}",
      "chat.approvalDialog.toast.approved": "工具 {toolName} 已执行",
      "chat.approvalDialog.toast.rejected": "已取消工具执行",
      "chat.approvalDialog.toast.executionFailed": "执行失败：{message}",
      "chat.approvalDialog.result.userRejected": "用户已拒绝工具执行",
      "chat.approvalDialog.risk.title": "风险等级 {level}",
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
    className,
  }: React.PropsWithChildren<{
    onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void
    disabled?: boolean
    className?: string
  }>) => (
    <button type="button" onClick={onClick} disabled={disabled} className={className}>
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
  AlertDialogContent: ({ children, className }: React.PropsWithChildren<{ className?: string }>) => (
    <div className={className}>{children}</div>
  ),
  AlertDialogDescription: ({ children }: React.PropsWithChildren<{ className?: string; asChild?: boolean }>) => <>{children}</>,
  AlertDialogFooter: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}))

jest.mock("@tauri-apps/api/core", () => ({
  invoke: jest.fn(),
}))

jest.mock("@/lib/api/bridge", () => ({
  bridgeCallTool: jest.fn(),
}))

jest.mock("sonner", () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
}))

const mockInvoke = invoke as jest.MockedFunction<typeof invoke>
const mockBridgeCallTool = bridgeCallTool as jest.MockedFunction<typeof bridgeCallTool>

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
    mockInvoke.mockReset()
    mockBridgeCallTool.mockReset()
    jest.clearAllMocks()
    act(() => {
      useBridgeApprovalStore.getState().clear()
      useBridgeApprovalStore.getState().clearRecentApprovedExecution()
      useChatStore.getState().resetSession()
    })
  })

  it("approves bridge MCP tools and reports the result back to the bridge", async () => {
    mockInvoke.mockResolvedValueOnce({ ok: true } as unknown)
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
    fireEvent.click(screen.getByRole("button", { name: "批准执行" }))

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("approve_mcp_tool", {
        approvalToken: "approval-1",
        callId: "call-1",
        executionToken: "exec-1",
      })
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
    expect(toast.success).toHaveBeenCalledWith("工具 write_file 已执行")
    expect(useBridgeApprovalStore.getState().pending).toBeNull()
  })

  it("closes the dialog immediately after local approval succeeds even if bridge callback is still pending", async () => {
    const deferredBridge = createDeferred<{ ok: boolean }>()
    mockInvoke.mockResolvedValueOnce({ ok: true } as unknown)
    mockBridgeCallTool.mockReturnValueOnce(deferredBridge.promise as never)

    act(() => {
      useBridgeApprovalStore.getState().setPending(
        createBridgeToolApproval({
          approval_token: "approval-bridge-pending-1",
          tool_name: "write_file",
          arguments: { path: "demo.txt" },
          meta: {
            call_id: "call-bridge-pending-1",
            execution_token: "exec-bridge-pending-1",
          },
        })
      )
    })

    render(<ToolApprovalDialog />)
    fireEvent.click(screen.getByRole("button", { name: "批准执行" }))

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("approve_mcp_tool", {
        approvalToken: "approval-bridge-pending-1",
        callId: "call-bridge-pending-1",
        executionToken: "exec-bridge-pending-1",
      })
    })

    await waitFor(() => {
      expect(useBridgeApprovalStore.getState().pending).toBeNull()
    })

    expect(mockBridgeCallTool).toHaveBeenCalledWith({
      tool_name: "write_file",
      arguments: {
        call_id: "call-bridge-pending-1",
        result: { ok: true },
        ok: true,
      },
      execution_token: "exec-bridge-pending-1",
    })

    deferredBridge.resolve({ ok: true })
  })

  it("resets loading when a new approval arrives after the previous approval was cleared", async () => {
    const firstApproval = createDeferred<unknown>()
    mockInvoke.mockReturnValueOnce(firstApproval.promise as never)
    mockInvoke.mockResolvedValueOnce({ ok: true } as unknown)

    render(<ToolApprovalDialog />)

    act(() => {
      useBridgeApprovalStore.getState().setPending(
        createBridgeToolApproval({
          approval_token: "approval-seq-1",
          tool_name: "write_file",
          arguments: { path: "first.txt" },
          meta: {
            call_id: "call-seq-1",
          },
        })
      )
    })

    fireEvent.click(screen.getByRole("button", { name: "批准执行" }))

    await waitFor(() => {
      expect(useBridgeApprovalStore.getState().pending).toBeNull()
    })

    act(() => {
      useBridgeApprovalStore.getState().setPending(
        createBridgeToolApproval({
          approval_token: "approval-seq-2",
          tool_name: "write_file",
          arguments: { path: "second.txt" },
          meta: {
            call_id: "call-seq-2",
          },
        })
      )
    })

    const secondApproveButton = screen.getByRole("button", { name: "批准执行" })
    expect(secondApproveButton).not.toBeDisabled()

    fireEvent.click(secondApproveButton)

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenNthCalledWith(2, "approve_mcp_tool", {
        approvalToken: "approval-seq-2",
        callId: "call-seq-2",
        executionToken: undefined,
      })
    })

    await act(async () => {
      firstApproval.resolve({ ok: true } as unknown)
      await firstApproval.promise
    })
  })

  it("closes immediately and restores the matching local tool call to running while approval is in flight", async () => {
    const deferredApproval = createDeferred<unknown>()
    mockInvoke.mockReturnValueOnce(deferredApproval.promise as never)

    act(() => {
      useChatStore.setState({
        messages: [
          {
            id: "assistant-local-running-1",
            role: "assistant",
            content: "",
            createdAt: 1,
            blocks: [
              {
                id: "call-local-running-1",
                type: "tool_call",
                callId: "call-local-running-1",
                toolName: "skill.official.skills.crawler.crawl_website",
                status: "success",
              } as MessageBlock,
              {
                id: "result-local-running-1",
                type: "tool_result",
                callId: "call-local-running-1",
                toolName: "skill.official.skills.crawler.crawl_website",
                status: "success",
                result: {
                  status: "REQUIRES_APPROVAL",
                  approval_token: "approval-local-running-1",
                  tool_name: "skill.official.skills.crawler.crawl_website",
                  arguments: { url: "https://example.com" },
                },
              } as MessageBlock,
            ],
          },
        ],
      })
      useBridgeApprovalStore.getState().setPending(
        createBridgeToolApproval({
          approval_token: "approval-local-running-1",
          tool_name: "skill.official.skills.crawler.crawl_website",
          arguments: { url: "https://example.com" },
          meta: {
            call_id: "call-local-running-1",
            message_id: "assistant-local-running-1",
          },
        })
      )
    })

    render(<ToolApprovalDialog />)
    fireEvent.click(screen.getByRole("button", { name: "批准执行" }))

    await waitFor(() => {
      expect(useBridgeApprovalStore.getState().pending).toBeNull()
    })

    const blocks = useChatStore.getState().messages[0]?.blocks ?? []
    expect(blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool_call",
          callId: "call-local-running-1",
          status: "running",
        }),
      ])
    )
    expect(
      blocks.some(
        (block) => block.type === "tool_result" && block.callId === "call-local-running-1"
      )
    ).toBe(false)
    expect(toast.success).toHaveBeenCalledWith(
      "已批准，正在执行 skill.official.skills.crawler.crawl_website"
    )

    deferredApproval.resolve({ ok: true })

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("approve_mcp_tool", {
        approvalToken: "approval-local-running-1",
        callId: "call-local-running-1",
        executionToken: undefined,
      })
    })
  })

  it("constrains long approval content so the footer actions remain reachable", () => {
    act(() => {
      useBridgeApprovalStore.getState().setPending(
        createBridgeToolApproval({
          approval_token: "approval-2",
          tool_name: "write_file",
          arguments: {
            path: "demo.txt",
            code: "line\n".repeat(200),
          },
          meta: {
            call_id: "call-2",
          },
        })
      )
    })

    render(<ToolApprovalDialog />)

    expect(
      screen.getByText("当前 AI 正请求在本地执行一个高风险工具。").parentElement
    ).toHaveClass("max-h-[60vh]", "overflow-y-auto")
    expect(screen.getByText("参数").nextElementSibling).toHaveClass(
      "max-h-[35vh]",
      "overflow-y-auto"
    )
  })

  it("renders a browser-specific human-readable summary when the approval is for browser actions", () => {
    act(() => {
      useBridgeApprovalStore.getState().setPending(
        createBrowserAwareApproval({
          approval_token: "approval-browser-dialog-1",
          tool_name: "browser_click",
          arguments: {
            tab_id: 42,
            target: { text: "Continue" },
          },
          meta: {
            call_id: "call-browser-dialog-1",
          },
        })
      )
    })

    render(<ToolApprovalDialog />)

    expect(screen.getByText("说明")).toBeInTheDocument()
    expect(
      screen.getByText('"Click the "Continue" element in the browser."')
    ).toBeInTheDocument()
  })

  it("uses translated rejection copy when the user denies execution", async () => {
    mockInvoke.mockResolvedValueOnce(undefined as never)
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
            message_id: "assistant-reject-1",
          },
        })
      )
    })

    render(<ToolApprovalDialog />)
    fireEvent.click(screen.getByRole("button", { name: "拒绝" }))

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("reject_mcp_tool", {
        approvalToken: "approval-3",
      })
    })

    expect(mockBridgeCallTool).toHaveBeenCalledWith({
      tool_name: "write_file",
      arguments: {
        call_id: "call-3",
        result: { error: "用户已拒绝工具执行" },
        ok: false,
      },
      execution_token: "exec-3",
    })
    expect(toast.info).toHaveBeenCalledWith("已取消工具执行")
  })

  it("writes approved local-chat tool results back into the matching assistant message", async () => {
    mockInvoke.mockResolvedValueOnce({
      status: "LOCAL_CHAT_RESUMED",
      approved_tool_result: { crawled_pages: 3 },
      continuation_blocks: [{ id: "resume-text-1", type: "text", content: "Finished crawl." }],
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
          },
        })
      )
    })

    render(<ToolApprovalDialog />)
    fireEvent.click(screen.getByRole("button", { name: "批准执行" }))

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("approve_mcp_tool", {
        approvalToken: "approval-local-1",
        callId: "call-local-1",
        executionToken: undefined,
      })
    })

    expect(mockBridgeCallTool).not.toHaveBeenCalled()
    expect(useChatStore.getState().messages[0]?.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool_result",
          callId: "call-local-1",
          status: "success",
          result: { crawled_pages: 3 },
        }),
        expect.objectContaining({
          type: "text",
          content: "Finished crawl.",
        }),
      ])
    )
  })

  it("writes approved local-chat tool results back by call_id when restored approval has no message_id", async () => {
    mockInvoke.mockResolvedValueOnce({
      status: "LOCAL_CHAT_RESUMED",
      approved_tool_result: { crawled_pages: 7 },
      continuation_blocks: [{ id: "resume-text-restore-1", type: "text", content: "Resumed after refresh." }],
    } as unknown)

    act(() => {
      useChatStore.setState({
        sessionId: "session-refresh-1",
        messages: [
          {
            id: "assistant-refresh-1",
            role: "assistant",
            content: "",
            createdAt: 1,
            fromHistory: true,
            blocks: [
              {
                id: "call-refresh-1",
                type: "tool_call",
                callId: "call-refresh-1",
                toolName: "skill.official.skills.crawler.crawl_website",
                status: "running",
              } as MessageBlock,
              {
                id: "result-refresh-1",
                type: "tool_result",
                callId: "call-refresh-1",
                toolName: "skill.official.skills.crawler.crawl_website",
                status: "success",
                result: {
                  status: "REQUIRES_APPROVAL",
                  approval_token: "approval-refresh-1",
                },
              } as MessageBlock,
            ],
          },
        ],
      })
      useBridgeApprovalStore.getState().setPending(
        createBridgeToolApproval({
          approval_token: "approval-refresh-1",
          tool_name: "skill.official.skills.crawler.crawl_website",
          arguments: { url: "https://example.com/refresh" },
          meta: {
            call_id: "call-refresh-1",
          },
        })
      )
    })

    render(<ToolApprovalDialog />)
    fireEvent.click(screen.getByRole("button", { name: "批准执行" }))

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("approve_mcp_tool", {
        approvalToken: "approval-refresh-1",
        callId: "call-refresh-1",
        executionToken: undefined,
      })
    })

    expect(useChatStore.getState().messages[0]?.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool_result",
          callId: "call-refresh-1",
          status: "success",
          result: { crawled_pages: 7 },
        }),
        expect.objectContaining({
          type: "text",
          content: "Resumed after refresh.",
        }),
      ])
    )
  })
})
