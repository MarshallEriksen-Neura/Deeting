import { deriveChatStatusUpdateForMessage } from "@/lib/chat/live-status"
import type { Message } from "@/store/chat-store"

describe("live status helpers", () => {
  it("returns a message-scoped status update for active execution blocks", () => {
    const messages = [
      {
        id: "assistant-live-1",
        role: "assistant",
        content: "",
        createdAt: 1,
        blocks: [
          {
            id: "exec-ui-1",
            type: "ui",
            viewType: "execution.lifecycle",
            payload: {
              schema_version: 1,
              root_execution_id: "exec-root-1",
              execution_kind: "workflow",
              execution_status: "running",
              target: {
                name: "Research Worker",
              },
            },
          },
        ],
      },
    ] as Message[]

    expect(
      deriveChatStatusUpdateForMessage(messages, "assistant-live-1")
    ).toMatchObject({
      messageId: "assistant-live-1",
      stage: "render",
      code: "execution.running",
      meta: {
        target_name: "Research Worker",
        execution_kind: "workflow",
        root_execution_id: "exec-root-1",
        execution_status: "running",
      },
    })
  })

  it("returns null for terminal execution state", () => {
    const messages = [
      {
        id: "assistant-done-1",
        role: "assistant",
        content: "",
        createdAt: 1,
        blocks: [
          {
            id: "exec-ui-2",
            type: "ui",
            viewType: "execution.lifecycle",
            payload: {
              schema_version: 1,
              root_execution_id: "exec-root-2",
              execution_kind: "workflow",
              execution_status: "integrated",
            },
          },
        ],
      },
    ] as Message[]

    expect(deriveChatStatusUpdateForMessage(messages, "assistant-done-1")).toBeNull()
  })
})
