"use client"

import React from "react"
import { render, waitFor } from "@testing-library/react"
import type { Message } from "@/lib/chat/message-types"
import { useBrowserModeToolActivity } from "@/hooks/chat/use-browser-mode-tool-activity"
import { useBrowserModeStore } from "@/store/browser-mode-store"
import { useWorkspaceStore } from "@/store/workspace-store"

function Harness({ messages }: { messages: Message[] }) {
  useBrowserModeToolActivity(messages)
  return null
}

describe("useBrowserModeToolActivity", () => {
  beforeEach(() => {
    useBrowserModeStore.getState().reset()
    useWorkspaceStore.getState().closeAll()
  })

  it("opens browser mode workspace and sets waiting state for browser wait tool calls", async () => {
    render(
      <Harness
        messages={[
          {
            id: "assistant-browser-1",
            role: "assistant",
            content: "",
            createdAt: 1,
            blocks: [
              {
                id: "call-browser-wait-1",
                type: "tool_call",
                callId: "call-browser-wait-1",
                toolName: "browser_wait_for_element",
                toolArgs: JSON.stringify({ target: { text: "Continue" } }),
                status: "running",
              },
            ],
          },
        ]}
      />
    )

    await waitFor(() => {
      expect(useWorkspaceStore.getState().views).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "browser-mode",
            type: "browser-mode",
          }),
        ])
      )
    })

    expect(useBrowserModeStore.getState().executionPhase).toBe("waiting")
    expect(useBrowserModeStore.getState().executionLabel).toBe("Waiting for target element")
    expect(useBrowserModeStore.getState().timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "tool_call",
          phase: "waiting",
          label: "Waiting for target element",
        }),
      ])
    )
  })

  it("hydrates recovery metadata from browser retry results", async () => {
    render(
      <Harness
        messages={[
          {
            id: "assistant-browser-2",
            role: "assistant",
            content: "",
            createdAt: 1,
            blocks: [
              {
                id: "call-browser-retry-1",
                type: "tool_call",
                callId: "call-browser-retry-1",
                toolName: "browser_retry_with_relocate",
                toolArgs: JSON.stringify({
                  action_kind: "click",
                  target: { text: "Continue" },
                }),
                status: "running",
              },
              {
                id: "result-browser-retry-1",
                type: "tool_result",
                callId: "call-browser-retry-1",
                toolName: "browser_retry_with_relocate",
                status: "success",
                result: {
                  ok: true,
                  attempts: 2,
                  recovered: true,
                  final_error: null,
                  last_snapshot_summary: {
                    url: "https://example.com/dashboard",
                    title: "Dashboard",
                    documentReadyState: "complete",
                  },
                },
              },
            ],
          },
        ]}
      />
    )

    await waitFor(() => {
      expect(useBrowserModeStore.getState().retryCount).toBe(2)
    })

    expect(useBrowserModeStore.getState().executionPhase).toBe("recovering")
    expect(useBrowserModeStore.getState().lastAction).toMatchObject({
      summary: "Recovered browser action after re-locating target",
    })
    expect(useBrowserModeStore.getState().timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "tool_result",
          phase: "recovering",
          label: "Recovered browser action after re-locating target",
        }),
      ])
    )
    expect(useBrowserModeStore.getState().page).toMatchObject({
      title: "Dashboard",
      url: "https://example.com/dashboard",
      host: "example.com",
    })
  })

  it("marks retry recovery as awaiting fresh approval when the recovered action needs approval again", async () => {
    render(
      <Harness
        messages={[
          {
            id: "assistant-browser-3",
            role: "assistant",
            content: "",
            createdAt: 1,
            blocks: [
              {
                id: "call-browser-retry-approval-1",
                type: "tool_call",
                callId: "call-browser-retry-approval-1",
                toolName: "browser_retry_with_relocate",
                toolArgs: JSON.stringify({
                  action_kind: "click",
                  target: { text: "Submit" },
                }),
                status: "running",
              },
              {
                id: "result-browser-retry-approval-1",
                type: "tool_result",
                callId: "call-browser-retry-approval-1",
                toolName: "browser_retry_with_relocate",
                status: "requires_approval",
                result: {
                  status: "REQUIRES_APPROVAL",
                  tool_name: "browser_click",
                  approval_token: "approval-browser-retry-approval-1",
                  recovered: true,
                  attempts: 2,
                  recovery_reason: "Target changed after refresh",
                  last_snapshot_summary: {
                    url: "https://example.com/submit",
                    title: "Submit",
                    documentReadyState: "complete",
                  },
                },
              },
            ],
          },
        ]}
      />
    )

    await waitFor(() => {
      expect(useBrowserModeStore.getState().retryCount).toBe(2)
    })

    expect(useBrowserModeStore.getState().executionPhase).toBe("recovering")
    expect(useBrowserModeStore.getState().lastAction).toMatchObject({
      summary: "Fresh approval required after recovery",
    })
    expect(useBrowserModeStore.getState().timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "tool_result",
          phase: "recovering",
          label: "Fresh approval required after recovery",
        }),
      ])
    )
  })
})
