"use client"

import React from "react"
import { act, render, waitFor } from "@testing-library/react"
import { useHydratePendingToolApproval } from "@/hooks/chat/use-hydrate-pending-tool-approval"
import { listPendingMcpApprovals } from "@/lib/api/mcp-approvals"
import {
  announceBridgeApprovalExecution,
  createBridgeToolApproval,
  useBridgeApprovalStore,
} from "@/lib/chat/bridge-approval-store"
import type { Message } from "@/lib/chat/message-types"

jest.mock("@/lib/api/mcp-approvals", () => ({
  listPendingMcpApprovals: jest.fn(),
}))

const mockListPendingMcpApprovals =
  listPendingMcpApprovals as jest.MockedFunction<typeof listPendingMcpApprovals>

function Harness({ sessionId, messages }: { sessionId: string | null; messages: Message[] }) {
  useHydratePendingToolApproval(sessionId, messages)
  return null
}

describe("useHydratePendingToolApproval", () => {
  const originalIsTauriEnv = process.env.NEXT_PUBLIC_IS_TAURI

  beforeEach(() => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    ;(window as Window & { __TAURI__?: Record<string, unknown> }).__TAURI__ = {}
  })

  afterEach(() => {
    mockListPendingMcpApprovals.mockReset()
    act(() => {
      useBridgeApprovalStore.getState().clearAll()
      useBridgeApprovalStore.getState().clearRecentApprovedExecution()
    })
    if (originalIsTauriEnv === undefined) {
      delete process.env.NEXT_PUBLIC_IS_TAURI
    } else {
      process.env.NEXT_PUBLIC_IS_TAURI = originalIsTauriEnv
    }
    delete (window as Window & { __TAURI__?: Record<string, unknown> }).__TAURI__
  })

  it("hydrates the latest pending approval for the active session from the runtime snapshot", async () => {
    mockListPendingMcpApprovals.mockResolvedValueOnce([
      {
        status: "REQUIRES_APPROVAL",
        approval_token: "approval-runtime-1",
        tool_name: "skill.official.skills.crawler.crawl_website",
        arguments: { url: "https://example.com/runtime" },
        description: "Crawl the requested site",
        risk_level: "MEDIUM",
        risk_reasons: ["Requires network access"],
        session_id: "session-runtime-1",
        call_id: "call-runtime-1",
      },
    ] as never)

    render(
      <Harness
        sessionId="session-runtime-1"
        messages={[
          {
            id: "assistant-runtime-1",
            role: "assistant",
            content: "",
            createdAt: 1,
            fromHistory: true,
            blocks: [
              {
                id: "call-runtime-1",
                type: "tool_call",
                callId: "call-runtime-1",
                toolName: "skill.official.skills.crawler.crawl_website",
                status: "running",
              },
              {
                id: "result-runtime-1",
                type: "tool_result",
                callId: "call-runtime-1",
                toolName: "skill.official.skills.crawler.crawl_website",
                status: "success",
                result: {
                  status: "REQUIRES_APPROVAL",
                  approval_token: "approval-runtime-1",
                },
              },
            ],
          },
        ]}
      />
    )

    await waitFor(() => {
      expect(mockListPendingMcpApprovals).toHaveBeenCalledWith("session-runtime-1")
    })

    await waitFor(() => {
      expect(useBridgeApprovalStore.getState().pending).toMatchObject({
        approval_token: "approval-runtime-1",
        tool_name: "skill.official.skills.crawler.crawl_website",
        arguments: { url: "https://example.com/runtime" },
        meta: {
          call_id: "call-runtime-1",
          message_id: "assistant-runtime-1",
        },
      })
    })
  })

  it("does not rehydrate the same runtime approval that was just approved locally", async () => {
    mockListPendingMcpApprovals.mockResolvedValueOnce([
      {
        status: "REQUIRES_APPROVAL",
        approval_token: "approval-runtime-inflight-1",
        tool_name: "skill.official.skills.crawler.crawl_website",
        arguments: { url: "https://example.com/runtime/inflight" },
        session_id: "session-runtime-inflight-1",
        call_id: "call-runtime-inflight-1",
      },
    ] as never)

    act(() => {
      announceBridgeApprovalExecution(
        createBridgeToolApproval({
          approval_token: "approval-runtime-inflight-1",
          tool_name: "skill.official.skills.crawler.crawl_website",
          arguments: { url: "https://example.com/runtime/inflight" },
          meta: {
            call_id: "call-runtime-inflight-1",
            message_id: "assistant-runtime-inflight-1",
          },
        })
      )
    })

    render(
      <Harness
        sessionId="session-runtime-inflight-1"
        messages={[
          {
            id: "assistant-runtime-inflight-1",
            role: "assistant",
            content: "",
            createdAt: 1,
            blocks: [
              {
                id: "call-runtime-inflight-1",
                type: "tool_call",
                callId: "call-runtime-inflight-1",
                toolName: "skill.official.skills.crawler.crawl_website",
                status: "running",
              },
            ],
          },
        ]}
      />
    )

    await waitFor(() => {
      expect(useBridgeApprovalStore.getState().pending).toBeNull()
    })

    expect(mockListPendingMcpApprovals).toHaveBeenCalledWith("session-runtime-inflight-1")
  })

  it("replaces stale queued approvals with the canonical runtime snapshot", async () => {
    mockListPendingMcpApprovals.mockResolvedValueOnce([
      {
        status: "REQUIRES_APPROVAL",
        approval_token: "approval-runtime-fresh-1",
        tool_name: "browser_click",
        arguments: { target: { text: "Continue" } },
        session_id: "session-runtime-refresh-1",
        call_id: "call-runtime-refresh-1",
      },
    ] as never)

    act(() => {
      useBridgeApprovalStore.getState().setPending(
        createBridgeToolApproval({
          approval_token: "approval-runtime-stale-1",
          tool_name: "shell_execute",
          arguments: { command: "dir" },
          meta: {
            call_id: "call-runtime-stale-1",
            message_id: "assistant-runtime-refresh-1",
          },
        })
      )
    })

    render(
      <Harness
        sessionId="session-runtime-refresh-1"
        messages={[
          {
            id: "assistant-runtime-refresh-1",
            role: "assistant",
            content: "",
            createdAt: 1,
            blocks: [
              {
                id: "call-runtime-refresh-1",
                type: "tool_call",
                callId: "call-runtime-refresh-1",
                toolName: "browser_click",
                status: "running",
              },
            ],
          },
        ]}
      />
    )

    await waitFor(() => {
      expect(useBridgeApprovalStore.getState().queue).toEqual([
        expect.objectContaining({
          approval_token: "approval-runtime-fresh-1",
          tool_name: "browser_click",
          meta: expect.objectContaining({
            call_id: "call-runtime-refresh-1",
            message_id: "assistant-runtime-refresh-1",
          }),
        }),
      ])
    })
  })
})
