"use client"

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { ToolApprovalDialog } from "@/components/bridge/tool-approval-dialog"
import {
  createBridgeToolApproval,
  createLocalCodeModeApproval,
  useBridgeApprovalStore,
} from "@/lib/chat/bridge-approval-store"
import { invoke } from "@tauri-apps/api/core"
import { bridgeCallTool } from "@/lib/api/bridge"
import { toast } from "sonner"
import { useChatStore } from "@/store/chat-store"

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
  AlertDialogContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
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
      useChatStore.setState({ messages: [], compareByMessageId: {} })
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

  it("approves local code-mode actions without calling the bridge callback", async () => {
    mockInvoke.mockResolvedValueOnce({
      blocks: [
        {
          id: "call-local-1-tool-result",
          type: "tool_result",
          callId: "call-local-1",
          toolName: "execute_code_plan",
          status: "success",
          result: { ok: true },
        },
      ],
      response: {
        choices: [
          {
            message: {
              content: "Done",
            },
          },
        ],
      },
    } as unknown)

    act(() => {
      useBridgeApprovalStore.getState().setPending(
        createLocalCodeModeApproval({
          approval_token: "approval-local-1",
          tool_name: "apply_patch",
          arguments: { target: "deeting/lib/chat/bridge-approval-store.ts" },
          description: "Continue the paused code-mode execution",
          meta: {
            session_id: "session-1",
            execution_id: "execution-1",
            approve_action: {
              command: "approve_pending_local_code_mode_execution",
            },
            reject_action: {
              command: "reject_pending_local_code_mode_execution",
            },
            assistant_message_id: "assistant-1",
            call_id: "call-local-1",
          },
        })
      )
    })

    useChatStore.setState({
      messages: [{ id: "assistant-1", role: "assistant", content: "", createdAt: Date.now() }],
    })

    render(<ToolApprovalDialog />)

    expect(screen.getByText("Approve Local Code Execution")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /allow execution/i }))

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("approve_pending_local_code_mode_execution", {
        approvalToken: "approval-local-1",
      })
    })

    expect(mockBridgeCallTool).not.toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalledWith(
      "Code-mode execution apply_patch approved"
    )
    expect(useChatStore.getState().messages[0]?.blocks).toBeDefined()
    expect(useBridgeApprovalStore.getState().pending).toBeNull()
  })
})
