import { deriveAssistantActivityState, isToolApprovalResultBlock } from "@/lib/chat/assistant-activity"
import type { MessageBlock } from "@/lib/chat/message-protocol"

describe("assistant activity helpers", () => {
  it("keeps approval-request blocks active until the user approves them", () => {
    const blocks: MessageBlock[] = [
      {
        id: "call-approval-1",
        type: "tool_call",
        callId: "call-approval-1",
        toolName: "skill.official.skills.crawler.fetch_web_content",
        status: "success",
      },
      {
        id: "result-approval-1",
        type: "tool_result",
        callId: "call-approval-1",
        toolName: "skill.official.skills.crawler.fetch_web_content",
        status: "requires_approval",
        result: {
          status: "REQUIRES_APPROVAL",
          approval_token: "approval-1",
        },
      },
    ]

    expect(isToolApprovalResultBlock(blocks[1])).toBe(true)
    expect(deriveAssistantActivityState(blocks)).toMatchObject({
      isActive: true,
      statusStage: "render",
      statusCode: "approval.required",
      statusMeta: {
        tool_name: "skill.official.skills.crawler.fetch_web_content",
        call_id: "call-approval-1",
      },
    })
  })

  it("keeps an approved tool call active while it is still running", () => {
    const blocks: MessageBlock[] = [
      {
        id: "call-running-1",
        type: "tool_call",
        callId: "call-running-1",
        toolName: "write_file",
        status: "running",
      },
    ]

    expect(deriveAssistantActivityState(blocks)).toMatchObject({
      isActive: true,
      statusStage: "render",
      statusCode: "approval.executing",
      statusMeta: {
        tool_name: "write_file",
        call_id: "call-running-1",
      },
    })
  })

  it("treats resolved tool results as inactive", () => {
    const blocks: MessageBlock[] = [
      {
        id: "call-success-1",
        type: "tool_call",
        callId: "call-success-1",
        toolName: "write_file",
        status: "success",
      },
      {
        id: "result-success-1",
        type: "tool_result",
        callId: "call-success-1",
        toolName: "write_file",
        status: "success",
        result: { ok: true },
      },
    ]

    expect(deriveAssistantActivityState(blocks)).toEqual({
      isActive: false,
      statusStage: null,
      statusCode: null,
      statusMeta: null,
    })
  })

  it("treats a later success result as terminal even if an older approval block for the same call remains", () => {
    const blocks: MessageBlock[] = [
      {
        id: "call-running-after-approve-1",
        type: "tool_call",
        callId: "call-running-after-approve-1",
        toolName: "shell_execute",
        status: "running",
      },
      {
        id: "result-approval-old-1",
        type: "tool_result",
        callId: "call-running-after-approve-1",
        toolName: "shell_execute",
        status: "requires_approval",
        result: {
          status: "REQUIRES_APPROVAL",
          approval_token: "approval-old-1",
        },
      },
      {
        id: "result-success-new-1",
        type: "tool_result",
        callId: "call-running-after-approve-1",
        toolName: "shell_execute",
        status: "success",
        result: { ok: true },
      },
    ]

    expect(deriveAssistantActivityState(blocks)).toEqual({
      isActive: false,
      statusStage: null,
      statusCode: null,
      statusMeta: null,
    })
  })

  it("does not treat a success block as pending approval just because result payload kept old approval status", () => {
    const blocks: MessageBlock[] = [
      {
        id: "call-success-approval-stale-1",
        type: "tool_call",
        callId: "call-success-approval-stale-1",
        toolName: "shell_execute",
        status: "success",
      },
      {
        id: "result-success-approval-stale-1",
        type: "tool_result",
        callId: "call-success-approval-stale-1",
        toolName: "shell_execute",
        status: "success",
        result: {
          status: "REQUIRES_APPROVAL",
          approval_token: "approval-stale-1",
          ok: true,
        },
      },
    ]

    expect(isToolApprovalResultBlock(blocks[1])).toBe(false)
    expect(deriveAssistantActivityState(blocks)).toEqual({
      isActive: false,
      statusStage: null,
      statusCode: null,
      statusMeta: null,
    })
  })

  it("treats a running execution lifecycle block as active", () => {
    const blocks: MessageBlock[] = [
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
      } as MessageBlock,
    ]

    expect(deriveAssistantActivityState(blocks)).toMatchObject({
      isActive: true,
      statusStage: "render",
      statusCode: "execution.running",
      statusMeta: {
        target_name: "Research Worker",
        execution_kind: "workflow",
        root_execution_id: "exec-root-1",
        execution_status: "running",
      },
    })
  })

  it("prefers a running execution lifecycle over stale approval blocks", () => {
    const blocks: MessageBlock[] = [
      {
        id: "exec-ui-running-1",
        type: "ui",
        viewType: "execution.lifecycle",
        payload: {
          schema_version: 1,
          root_execution_id: "exec-root-running-1",
          execution_kind: "workflow",
          execution_status: "running",
          target: {
            name: "Research Worker",
          },
        },
      } as MessageBlock,
      {
        id: "call-running-stale-1",
        type: "tool_call",
        callId: "call-running-stale-1",
        toolName: "shell_execute",
        status: "running",
      },
      {
        id: "result-running-stale-1",
        type: "tool_result",
        callId: "call-running-stale-1",
        toolName: "shell_execute",
        status: "requires_approval",
        result: {
          status: "REQUIRES_APPROVAL",
          approval_token: "approval-running-stale-1",
        },
      },
    ]

    expect(deriveAssistantActivityState(blocks)).toMatchObject({
      isActive: true,
      statusStage: "render",
      statusCode: "execution.running",
      statusMeta: {
        target_name: "Research Worker",
        execution_kind: "workflow",
        root_execution_id: "exec-root-running-1",
        execution_status: "running",
      },
    })
  })

  it("treats a waiting approval execution lifecycle as approval-required activity", () => {
    const blocks: MessageBlock[] = [
      {
        id: "exec-ui-waiting-1",
        type: "ui",
        viewType: "execution.lifecycle",
        payload: {
          schema_version: 1,
          root_execution_id: "exec-root-waiting-1",
          execution_kind: "workflow",
          execution_status: "waiting_approval",
        },
      } as MessageBlock,
    ]

    expect(deriveAssistantActivityState(blocks)).toEqual({
      isActive: true,
      statusStage: "render",
      statusCode: "approval.required",
      statusMeta: {
        execution_status: "waiting_approval",
        root_execution_id: "exec-root-waiting-1",
      },
    })
  })

  it("treats an integrated execution lifecycle as terminal even if stale approval blocks remain", () => {
    const blocks: MessageBlock[] = [
      {
        id: "exec-ui-integrated-1",
        type: "ui",
        viewType: "execution.lifecycle",
        payload: {
          schema_version: 1,
          root_execution_id: "exec-root-integrated-1",
          execution_kind: "workflow",
          execution_status: "integrated",
          target: {
            name: "Research Worker",
          },
        },
      } as MessageBlock,
      {
        id: "call-integrated-stale-1",
        type: "tool_call",
        callId: "call-integrated-stale-1",
        toolName: "shell_execute",
        status: "running",
      },
      {
        id: "result-integrated-stale-1",
        type: "tool_result",
        callId: "call-integrated-stale-1",
        toolName: "shell_execute",
        status: "requires_approval",
        result: {
          status: "REQUIRES_APPROVAL",
          approval_token: "approval-integrated-stale-1",
        },
      },
    ]

    expect(deriveAssistantActivityState(blocks)).toEqual({
      isActive: false,
      statusStage: null,
      statusCode: null,
      statusMeta: null,
    })
  })
})
