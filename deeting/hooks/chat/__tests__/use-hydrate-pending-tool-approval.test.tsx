"use client"

import React from "react"
import { act, render, waitFor } from "@testing-library/react"
import { invoke } from "@tauri-apps/api/core"
import { useHydratePendingToolApproval } from "@/hooks/chat/use-hydrate-pending-tool-approval"
import {
  announceBridgeApprovalExecution,
  createBridgeToolApproval,
  useBridgeApprovalStore,
} from "@/lib/chat/bridge-approval-store"
import type { Message } from "@/lib/chat/message-types"

jest.mock("@tauri-apps/api/core", () => ({
  invoke: jest.fn(),
}))

const mockInvoke = invoke as jest.MockedFunction<typeof invoke>

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
    mockInvoke.mockReset()
    act(() => {
      useBridgeApprovalStore.getState().clear()
    })
    if (originalIsTauriEnv === undefined) {
      delete process.env.NEXT_PUBLIC_IS_TAURI
    } else {
      process.env.NEXT_PUBLIC_IS_TAURI = originalIsTauriEnv
    }
    delete (window as Window & { __TAURI__?: Record<string, unknown> }).__TAURI__
  })

  it("hydrates the latest pending approval for the active session from the runtime snapshot", async () => {
    mockInvoke.mockResolvedValueOnce([
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
      expect(mockInvoke).toHaveBeenCalledWith("list_pending_mcp_approvals", {
        sessionId: "session-runtime-1",
      })
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
    mockInvoke.mockResolvedValueOnce([
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

    expect(mockInvoke).toHaveBeenCalledWith("list_pending_mcp_approvals", {
      sessionId: "session-runtime-inflight-1",
    })
  })
})
