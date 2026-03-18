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
  afterEach(() => {
    useBridgeApprovalStore.getState().clear()
  })

  it("queues pending approval from assistant message tool results", async () => {
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
            status: "success",
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
})
