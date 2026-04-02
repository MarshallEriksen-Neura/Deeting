import { normalizeConversationMessages } from "@/lib/chat/conversation-adapter"

describe("normalizeConversationMessages", () => {
  it("prefers renderable meta blocks when backend content is partial", () => {
    const messages = [
      {
        role: "assistant",
        content: "相比同价位竞品散热表现中等偏上",
        turn_index: 8,
        meta_info: {
          blocks: [
            {
              type: "text",
              content: "### 优势\n- 同配置价格更低\n- 散热表现中等偏上",
            },
          ],
        },
      },
    ]

    const [message] = normalizeConversationMessages(
      messages as unknown as Parameters<typeof normalizeConversationMessages>[0],
      {
        includeRoles: ["assistant"],
      }
    )

    expect(message?.blocks).toEqual([
      expect.objectContaining({
        type: "text",
        content: "### 优势\n- 同配置价格更低\n- 散热表现中等偏上",
      }),
    ])
    expect(message?.content).toBe("### 优势\n- 同配置价格更低\n- 散热表现中等偏上")
  })

  it("enforces block-first when assistant meta blocks are empty", () => {
    const messages = [
      {
        role: "assistant",
        content: "第一行\n第二行",
        turn_index: 9,
        meta_info: {
          blocks: [{ type: "text", content: "   " }],
        },
      },
    ]

    const [message] = normalizeConversationMessages(
      messages as unknown as Parameters<typeof normalizeConversationMessages>[0],
      {
        includeRoles: ["assistant"],
      }
    )

    expect(message?.blocks).toEqual([])
    expect(message?.content).toBe("")
  })

  it("normalizes escaped newlines in assistant text blocks", () => {
    const messages = [
      {
        role: "assistant",
        content: "should-not-be-used",
        turn_index: 10,
        meta_info: {
          blocks: [
            {
              type: "text",
              content: "第一行\\n第二行\\n第三行",
            },
          ],
        },
      },
    ]

    const [message] = normalizeConversationMessages(
      messages as unknown as Parameters<typeof normalizeConversationMessages>[0],
      {
        includeRoles: ["assistant"],
      }
    )

    expect(message?.content).toBe("第一行\n第二行\n第三行")
    expect(message?.blocks).toEqual([
      expect.objectContaining({
        type: "text",
        content: "第一行\n第二行\n第三行",
      }),
    ])
  })

  it("keeps tool_result blocks from meta_info for history replay", () => {
    const messages = [
      {
        role: "assistant",
        content: "已执行工具",
        turn_index: 11,
        meta_info: {
          blocks: [
            {
              type: "text",
              content: "已执行工具",
            },
            {
              type: "tool_result",
              toolName: "search_web",
              callId: "call_1",
              status: "success",
              result: "line1\\nline2",
            },
          ],
        },
      },
    ]

    const [message] = normalizeConversationMessages(
      messages as unknown as Parameters<typeof normalizeConversationMessages>[0],
      {
        includeRoles: ["assistant"],
      }
    )

    expect(message?.blocks).toEqual([
      expect.objectContaining({
        type: "text",
        content: "已执行工具",
      }),
      expect.objectContaining({
        type: "tool_result",
        toolName: "search_web",
        callId: "call_1",
        status: "success",
        result: "line1\nline2",
      }),
    ])
  })

  it("preserves tool_result debug payload for observability replay", () => {
    const messages = [
      {
        role: "assistant",
        content: "执行完成",
        turn_index: 15,
        meta_info: {
          blocks: [
            {
              type: "tool_result",
              toolName: "execute_code_plan",
              callId: "call_debug_1",
              status: "success",
              result: "ok",
              debug: {
                execution_id: "exec_001",
                runtime_tool_calls: {
                  count: 2,
                },
                sdk_stub: {
                  module: "deeting_sdk",
                  tool_count: 5,
                },
              },
            },
          ],
        },
      },
    ]

    const [message] = normalizeConversationMessages(
      messages as unknown as Parameters<typeof normalizeConversationMessages>[0],
      {
        includeRoles: ["assistant"],
      }
    )

    expect(message?.blocks).toEqual([
      expect.objectContaining({
        type: "tool_result",
        callId: "call_debug_1",
        debug: expect.objectContaining({
          execution_id: "exec_001",
          runtime_tool_calls: expect.objectContaining({ count: 2 }),
          sdk_stub: expect.objectContaining({
            module: "deeting_sdk",
            tool_count: 5,
          }),
        }),
      }),
    ])
  })

  it("keeps error block as renderable assistant output", () => {
    const messages = [
      {
        role: "assistant",
        content: "legacy-error-text",
        turn_index: 12,
        meta_info: {
          blocks: [
            {
              type: "error",
              message: "request failed\\ncode=upstream_timeout",
            },
          ],
        },
      },
    ]

    const [message] = normalizeConversationMessages(
      messages as unknown as Parameters<typeof normalizeConversationMessages>[0],
      {
        includeRoles: ["assistant"],
      }
    )

    expect(message?.content).toBe("")
    expect(message?.blocks).toEqual([
      expect.objectContaining({
        type: "error",
        message: "request failed\ncode=upstream_timeout",
      }),
    ])
  })

  it("keeps ui block as renderable assistant output for history replay", () => {
    const messages = [
      {
        role: "assistant",
        content: "legacy-ui-text",
        turn_index: 16,
        meta_info: {
          blocks: [
            {
              type: "ui",
              viewType: "table.simple",
              payload: {
                rows: [{ name: "Alice", score: 98 }],
              },
              title: "Top Result",
            },
          ],
        },
      },
    ]

    const [message] = normalizeConversationMessages(
      messages as unknown as Parameters<typeof normalizeConversationMessages>[0],
      {
        includeRoles: ["assistant"],
      }
    )

    expect(message?.content).toBe("")
    expect(message?.blocks).toEqual([
      expect.objectContaining({
        type: "ui",
        viewType: "table.simple",
        payload: {
          rows: [{ name: "Alice", score: 98 }],
        },
        title: "Top Result",
      }),
    ])
  })

  it("reconstructs execution lifecycle ui block from meta_info.execution_tree when blocks are absent", () => {
    const messages = [
      {
        role: "assistant",
        content: "",
        turn_index: 17,
        meta_info: {
          execution_tree: {
            execution_id: "exec-1",
            execution_kind: "workflow",
            target: {
              name: "Research Worker",
              workflow_run_id: "run-123",
            },
          },
        },
      },
    ]

    const [message] = normalizeConversationMessages(
      messages as unknown as Parameters<typeof normalizeConversationMessages>[0],
      {
        includeRoles: ["assistant"],
      }
    )

    expect(message?.blocks).toEqual([
      expect.objectContaining({
        type: "ui",
        viewType: "execution.lifecycle",
        title: "Delegated Execution · Research Worker",
        payload: expect.objectContaining({
          execution_id: "exec-1",
          execution_kind: "workflow",
        }),
        metadata: expect.objectContaining({
          workflow_run_id: "run-123",
        }),
      }),
    ])
  })

  it("uses backend created_at as message createdAt", () => {
    const createdAtIso = "2026-02-01T10:20:30.000Z"
    const [message] = normalizeConversationMessages(
      [
        {
          role: "assistant",
          content: "hello",
          turn_index: 13,
          created_at: createdAtIso,
        },
      ] as unknown as Parameters<typeof normalizeConversationMessages>[0],
      {
        includeRoles: ["assistant"],
      }
    )

    expect(message?.createdAt).toBe(Date.parse(createdAtIso))
  })

  it("does not synthesize blocks for user messages", () => {
    const [message] = normalizeConversationMessages(
      [
        {
          role: "user",
          content: "用户输入",
          turn_index: 14,
        },
      ] as unknown as Parameters<typeof normalizeConversationMessages>[0],
      {
        includeRoles: ["user"],
      }
    )

    expect(message?.content).toBe("用户输入")
    expect(message?.blocks).toBeUndefined()
  })
})
