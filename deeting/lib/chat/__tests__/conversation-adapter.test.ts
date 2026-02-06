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
  })

  it("falls back to parsed text when meta blocks are empty", () => {
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

    expect(message?.blocks).toEqual([
      expect.objectContaining({
        type: "text",
        content: "第一行\n第二行",
      }),
    ])
  })

  it("normalizes escaped newlines in content strings", () => {
    const messages = [
      {
        role: "assistant",
        content: "第一行\\n第二行\\n第三行",
        turn_index: 10,
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
})
