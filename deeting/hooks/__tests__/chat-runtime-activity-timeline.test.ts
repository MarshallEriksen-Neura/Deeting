import {
  activityEventFromStatus,
  activityEventsFromBlocks,
  buildActivityTimelineViewModel,
  createActivityTimelineBlock,
  mergeActivityTimelineBlock,
} from "@/lib/chat/runtime-activity"
import type { ActivityTimelineBlock, MessageBlock } from "@/lib/chat/message-protocol"

describe("runtime activity timeline", () => {
  it("maps useful status events to user-facing activity nodes", () => {
    const event = activityEventFromStatus({
      messageId: "m1",
      stage: "remember",
      code: "context.loaded",
      meta: { count: 4 },
      timestamp: 100,
    })

    expect(event).toMatchObject({
      id: "status:context.loaded",
      title: "读取上下文",
      detail: "4 条上下文",
      status: "running",
      source: "status",
    })
  })

  it("maps world-model frame statuses into visible activity nodes", () => {
    const request = activityEventFromStatus({
      messageId: "m1",
      stage: "evolve",
      code: "world_model.frame_refresh.request",
      meta: { model_role: "secretary", model_id: "mimo-v2.5-pro" },
      timestamp: 100,
    })
    const updated = activityEventFromStatus({
      messageId: "m1",
      stage: "evolve",
      code: "world_model.frame_refresh.updated",
      meta: { facts: 2, assumptions: 1, resolved_unknowns: 1 },
      timestamp: 200,
    })

    expect(request).toMatchObject({
      id: "status:world_model.frame_refresh.request",
      title: "秘书模型分析中",
      detail: "secretary · mimo-v2.5-pro",
      status: "running",
      source: "status",
    })
    expect(updated).toMatchObject({
      id: "status:world_model.frame_refresh.updated",
      title: "世界模型已更新",
      detail: "2 事实 · 1 假设 · 解决 1 未知",
      level: "success",
      status: "done",
      source: "status",
    })
  })

  it("dedupes repeated status events while preserving later detail", () => {
    const first = createActivityTimelineBlock("m1", [
      activityEventFromStatus({
        messageId: "m1",
        stage: "remember",
        code: "routing.selected",
        meta: { route: "direct" },
        timestamp: 100,
      })!,
    ])!
    const second = createActivityTimelineBlock("m1", [
      activityEventFromStatus({
        messageId: "m1",
        stage: "remember",
        code: "routing.selected",
        meta: { route: "direct", model_id: "mimo" },
        timestamp: 200,
      })!,
    ])!

    const merged = mergeActivityTimelineBlock(first, second)

    expect(merged.events).toHaveLength(1)
    expect(merged.events[0]).toMatchObject({
      id: "status:routing.selected",
      title: "选择执行路径",
      detail: "direct · mimo",
      timestamp: 100,
    })
  })

  it("updates a tool call row when the matching result arrives", () => {
    const toolCall = {
      id: "call-1",
      type: "tool_call",
      callId: "call-1",
      toolName: "browser_get_page_snapshot",
      status: "running",
    } as MessageBlock
    const toolResult = {
      id: "result-1",
      type: "tool_result",
      callId: "call-1",
      toolName: "browser_get_page_snapshot",
      status: "success",
      result: { ok: true },
    } as MessageBlock

    const first = createActivityTimelineBlock("m1", activityEventsFromBlocks("m1", [toolCall], 100))!
    const second = createActivityTimelineBlock("m1", activityEventsFromBlocks("m1", [toolResult], 200))!
    const merged = mergeActivityTimelineBlock(first, second)

    expect(merged.events).toHaveLength(1)
    expect(merged.events[0]).toMatchObject({
      title: "读取浏览器页面",
      status: "done",
      level: "success",
    })
  })

  it("collapses clean completed timelines but keeps failures expanded", () => {
    const cleanBlock: ActivityTimelineBlock = {
      id: "m1-activity-timeline",
      type: "activity_timeline",
      events: [
        {
          id: "tool:call-1:search_sdk",
          messageId: "m1",
          stage: "tool",
          level: "success",
          title: "搜索资料",
          status: "done",
          timestamp: 100,
          source: "tool_result",
          collapsible: true,
        },
      ],
    }

    expect(buildActivityTimelineViewModel(cleanBlock, { isActive: false })).toMatchObject({
      visible: true,
      collapsed: true,
      summary: "完成 · 搜索资料",
    })

    const failedBlock: ActivityTimelineBlock = {
      ...cleanBlock,
      events: [
        {
          ...cleanBlock.events[0],
          id: "tool:call-1:shell_execute",
          level: "error",
          title: "执行命令",
          status: "failed",
          critical: true,
        },
      ],
    }

    expect(buildActivityTimelineViewModel(failedBlock, { isActive: false })).toMatchObject({
      visible: true,
      collapsed: false,
    })
  })
})
