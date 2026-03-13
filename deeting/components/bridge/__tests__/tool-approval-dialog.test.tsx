"use client"

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { ToolApprovalDialog } from "@/components/bridge/tool-approval-dialog"
import {
  createBridgeToolApproval,
  useBridgeApprovalStore,
} from "@/lib/chat/bridge-approval-store"
import { invoke } from "@tauri-apps/api/core"
import { bridgeCallTool } from "@/lib/api/bridge"
import { toast } from "sonner"
import { useChatStore } from "@/store/chat-store"
import type { MessageBlock } from "@/lib/chat/message-protocol"

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
  AlertDialogDescription: ({ children, className }: React.PropsWithChildren<{ className?: string }>) => (
    <div className={className}>{children}</div>
  ),
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

describe("ToolApprovalDialog", () => {
  afterEach(() => {
    mockInvoke.mockReset()
    mockBridgeCallTool.mockReset()
    jest.clearAllMocks()
    act(() => {
      useBridgeApprovalStore.getState().clear()
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
    fireEvent.click(screen.getByRole("button", { name: /allow execution/i }))

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
    expect(toast.success).toHaveBeenCalledWith("Tool write_file executed successfully")
    expect(useBridgeApprovalStore.getState().pending).toBeNull()
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
      screen.getByText(/AI is requesting to execute a high-risk tool/i).parentElement
    ).toHaveClass("max-h-[60vh]", "overflow-y-auto")
    expect(screen.getByText("write_file").parentElement).toHaveClass(
      "max-h-[40vh]",
      "overflow-y-auto"
    )
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
    fireEvent.click(screen.getByRole("button", { name: /allow execution/i }))

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
})
