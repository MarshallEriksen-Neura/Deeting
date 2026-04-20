"use client"

import React from "react"
import { render, waitFor } from "@testing-library/react"
import type { MessageBlock } from "@/lib/chat/message-protocol"
import { useBridgeApprovalStore } from "@/lib/chat/bridge-approval-store"
import { useMessageToolApproval } from "@/hooks/chat/use-message-tool-approval"

function Harness({
  messageId,
  blocks,
  fromHistory = false,
}: {
  messageId: string
  blocks: MessageBlock[]
  fromHistory?: boolean
}) {
  useMessageToolApproval(messageId, blocks, { fromHistory })
  return null
}

describe("useMessageToolApproval", () => {
  const originalIsTauriEnv = process.env.NEXT_PUBLIC_IS_TAURI
  const originalTauri = (window as Record<string, unknown>).__TAURI__

  afterEach(() => {
    useBridgeApprovalStore.getState().clearAll()
    process.env.NEXT_PUBLIC_IS_TAURI = originalIsTauriEnv
    if (originalTauri === undefined) {
      delete (window as Record<string, unknown>).__TAURI__
    } else {
      ;(window as Record<string, unknown>).__TAURI__ = originalTauri
    }
  })

  it("queues pending approval from assistant message tool results that are still awaiting approval", async () => {
    render(
      <Harness
        messageId="assistant-approval-1"
        blocks={[
          {
            id: "tool-call-1",
            type: "tool_call",
            callId: "call-approval-1",
            toolName: "skill.official.skills.crawler.crawl_website",
            status: "running",
          },
          {
            id: "tool-result-1",
            type: "tool_result",
            callId: "call-approval-1",
            toolName: "skill.official.skills.crawler.crawl_website",
            status: "requires_approval",
            result: {
              status: "REQUIRES_APPROVAL",
              approval_token: "approval-queue-1",
              tool_name: "skill.official.skills.crawler.crawl_website",
              arguments: { url: "https://example.com" },
              risk_level: "MEDIUM",
            },
          },
        ]}
      />
    )

    await waitFor(() => {
      expect(useBridgeApprovalStore.getState().pending).toMatchObject({
        approval_token: "approval-queue-1",
        tool_name: "skill.official.skills.crawler.crawl_website",
        arguments: { url: "https://example.com" },
        meta: {
          call_id: "call-approval-1",
          message_id: "assistant-approval-1",
        },
      })
    })
  })

  it("does not re-queue a stale approval payload once the tool result is already marked success", async () => {
    render(
      <Harness
        messageId="assistant-approved-1"
        blocks={[
          {
            id: "tool-call-approved-1",
            type: "tool_call",
            callId: "call-approved-1",
            toolName: "shell_execute",
            status: "success",
          },
          {
            id: "tool-result-approved-1",
            type: "tool_result",
            callId: "call-approved-1",
            toolName: "shell_execute",
            status: "success",
            result: {
              status: "REQUIRES_APPROVAL",
              approval_token: "approval-stale-success-1",
              tool_name: "shell_execute",
              arguments: { command: "dir" },
              ok: true,
            },
          },
        ]}
      />
    )

    await waitFor(() => {
      expect(useBridgeApprovalStore.getState().pending).toBeNull()
      expect(useBridgeApprovalStore.getState().queue).toEqual([])
    })
  })

  it("skips a resolved stale approval and queues the newer unresolved approval in the same assistant message", async () => {
    render(
      <Harness
        messageId="assistant-multi-approval-1"
        blocks={[
          {
            id: "tool-call-old-1",
            type: "tool_call",
            callId: "call-old-1",
            toolName: "shell_execute",
            status: "success",
          },
          {
            id: "tool-result-old-1",
            type: "tool_result",
            callId: "call-old-1",
            toolName: "shell_execute",
            status: "success",
            result: {
              status: "REQUIRES_APPROVAL",
              approval_token: "approval-old-stale-1",
              tool_name: "shell_execute",
              arguments: { command: "dir" },
              execution_graph_execution_id: "graph-old-1",
            },
          },
          {
            id: "tool-call-new-1",
            type: "tool_call",
            callId: "call-new-1",
            toolName: "search_notes",
            status: "running",
          },
          {
            id: "tool-result-new-1",
            type: "tool_result",
            callId: "call-new-1",
            toolName: "search_notes",
            status: "requires_approval",
            result: {
              status: "REQUIRES_APPROVAL",
              approval_token: "approval-new-live-1",
              tool_name: "search_notes",
              arguments: { query: "approval queue" },
              execution_graph_execution_id: "graph-new-1",
            },
          },
        ]}
      />
    )

    await waitFor(() => {
      expect(useBridgeApprovalStore.getState().pending).toMatchObject({
        approval_token: "approval-new-live-1",
        tool_name: "search_notes",
        meta: {
          call_id: "call-new-1",
          message_id: "assistant-multi-approval-1",
          execution_graph_execution_id: "graph-new-1",
        },
      })
      expect(useBridgeApprovalStore.getState().queue).toHaveLength(1)
    })
  })

  it("does not queue approvals from history-replayed assistant messages", async () => {
    render(
      <Harness
        messageId="assistant-history-approval-1"
        fromHistory
        blocks={[
          {
            id: "tool-call-history-1",
            type: "tool_call",
            callId: "call-history-approval-1",
            toolName: "skill.official.skills.crawler.crawl_website",
            status: "running",
          },
          {
            id: "tool-result-history-1",
            type: "tool_result",
            callId: "call-history-approval-1",
            toolName: "skill.official.skills.crawler.crawl_website",
            status: "success",
            result: {
              status: "REQUIRES_APPROVAL",
              approval_token: "approval-history-1",
              tool_name: "skill.official.skills.crawler.crawl_website",
              arguments: { url: "https://example.com/history" },
              risk_level: "MEDIUM",
            },
          },
        ]}
      />
    )

    await waitFor(() => {
      expect(useBridgeApprovalStore.getState().pending).toBeNull()
    })
  })

  it("does not queue approvals from assistant blocks in tauri runtime", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    ;(window as Record<string, unknown>).__TAURI__ = {}

    render(
      <Harness
        messageId="assistant-tauri-approval-1"
        blocks={[
          {
            id: "tool-call-tauri-1",
            type: "tool_call",
            callId: "call-tauri-1",
            toolName: "shell_execute",
            status: "running",
          },
          {
            id: "tool-result-tauri-1",
            type: "tool_result",
            callId: "call-tauri-1",
            toolName: "shell_execute",
            status: "requires_approval",
            result: {
              status: "REQUIRES_APPROVAL",
              approval_token: "approval-tauri-1",
              tool_name: "shell_execute",
              arguments: { command: "dir" },
            },
          },
        ]}
      />
    )

    await waitFor(() => {
      expect(useBridgeApprovalStore.getState().pending).toBeNull()
      expect(useBridgeApprovalStore.getState().queue).toEqual([])
    })
  })
})
