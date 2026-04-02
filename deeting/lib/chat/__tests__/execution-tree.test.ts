import {
  buildExecutionLifecycleBlocksFromMessage,
  extractExecutionTreeBlockFromBlocks,
  extractExecutionTreeFromMessage,
  extractRootExecutionIdFromExecutionTree,
  extractRootExecutionIdFromMessage,
  extractExecutionTreeSchemaVersion,
  extractWorkflowRunIdFromMessage,
  findExecutionTreeByRootId,
  extractWorkflowRunIdFromExecutionTree,
} from "@/lib/chat/execution-tree"
import type { MessageBlock } from "@/lib/chat/message-protocol"

describe("execution-tree helpers", () => {
  it("finds the execution lifecycle ui block", () => {
    const blocks: MessageBlock[] = [
      {
        id: "ui-1",
        type: "ui",
        viewType: "execution.lifecycle",
        payload: {
          schema_version: 1,
          root_execution_id: "exec-1",
          execution_id: "exec-1",
        },
      },
    ] as MessageBlock[]

    expect(extractExecutionTreeBlockFromBlocks(blocks)).toMatchObject({
      viewType: "execution.lifecycle",
    })
  })

  it("reads execution tree from message blocks before metaInfo fallback", () => {
    const executionTree = extractExecutionTreeFromMessage({
      blocks: [
        {
          id: "ui-1",
          type: "ui",
          viewType: "execution.lifecycle",
          payload: {
            schema_version: 1,
            root_execution_id: "exec-1",
            execution_id: "exec-1",
            target: { workflow_run_id: "run-123" },
          },
        } as MessageBlock,
      ],
      metaInfo: {
        execution_tree: {
          execution_id: "exec-legacy",
        },
      },
    })

    expect(executionTree).toMatchObject({
      schema_version: 1,
      root_execution_id: "exec-1",
      execution_id: "exec-1",
    })
    expect(extractRootExecutionIdFromExecutionTree(executionTree)).toBe("exec-1")
    expect(
      extractRootExecutionIdFromMessage({
        blocks: [
          {
            id: "ui-1",
            type: "ui",
            viewType: "execution.lifecycle",
            payload: executionTree,
          } as MessageBlock,
        ],
        metaInfo: undefined,
      })
    ).toBe("exec-1")
    expect(extractExecutionTreeSchemaVersion(executionTree)).toBe(1)
    expect(extractWorkflowRunIdFromExecutionTree(executionTree)).toBe("run-123")
    expect(
      extractWorkflowRunIdFromMessage({
        blocks: [
          {
            id: "ui-1",
            type: "ui",
            viewType: "execution.lifecycle",
            payload: executionTree,
          } as MessageBlock,
        ],
        metaInfo: undefined,
      })
    ).toBe("run-123")
  })

  it("falls back to metaInfo.execution_tree when blocks are absent", () => {
    const executionTree = extractExecutionTreeFromMessage({
      blocks: undefined,
      metaInfo: {
        execution_tree: {
          schema_version: 1,
          root_execution_id: "exec-2",
          execution_id: "exec-2",
          target: { workflow_run_id: "run-456" },
        },
      },
    })

    expect(executionTree).toMatchObject({
      schema_version: 1,
      root_execution_id: "exec-2",
      execution_id: "exec-2",
    })
    expect(extractRootExecutionIdFromExecutionTree(executionTree)).toBe("exec-2")
    expect(extractExecutionTreeSchemaVersion(executionTree)).toBe(1)
    expect(extractWorkflowRunIdFromExecutionTree(executionTree)).toBe("run-456")
    expect(
      extractWorkflowRunIdFromMessage({
        blocks: undefined,
        metaInfo: {
          execution_tree: executionTree,
        },
      })
    ).toBe("run-456")
  })

  it("finds the latest execution tree by root execution id across messages", () => {
    const messages = [
      {
        metaInfo: {
          execution_tree: {
            schema_version: 1,
            root_execution_id: "exec-1",
            execution_id: "exec-1",
            execution_status: "launching",
          },
        },
      },
      {
        blocks: [
          {
            id: "ui-1",
            type: "ui",
            viewType: "execution.lifecycle",
            payload: {
              schema_version: 1,
              root_execution_id: "exec-1",
              execution_id: "exec-1",
              execution_status: "integrated",
            },
          } as MessageBlock,
        ],
      },
      {
        metaInfo: {
          execution_tree: {
            schema_version: 1,
            root_execution_id: "exec-2",
            execution_id: "exec-2",
          },
        },
      },
    ] as Array<{ blocks?: MessageBlock[]; metaInfo?: Record<string, unknown> }>

    expect(findExecutionTreeByRootId(messages, "exec-1")).toMatchObject({
      execution_status: "integrated",
    })
    expect(findExecutionTreeByRootId(messages, "exec-2")).toMatchObject({
      execution_id: "exec-2",
    })
    expect(findExecutionTreeByRootId(messages, "missing")).toBeNull()
  })

  it("builds execution lifecycle blocks directly from a message execution tree", () => {
    const blocks = buildExecutionLifecycleBlocksFromMessage(
      {
        blocks: undefined,
        metaInfo: {
          execution_tree: {
            schema_version: 1,
            root_execution_id: "exec-3",
            execution_id: "exec-3",
            target: {
              name: "Image Worker",
              workflow_run_id: "run-789",
            },
          },
        },
      },
      {
        id: "message-1-execution-tree",
        title: "Delegated Execution",
        displayMode: "bubble",
        streamState: "completed",
      }
    )

    expect(blocks).toEqual([
      expect.objectContaining({
        id: "message-1-execution-tree",
        type: "ui",
        viewType: "execution.lifecycle",
        title: "Delegated Execution",
        metadata: expect.objectContaining({
          workflow_run_id: "run-789",
        }),
      }),
    ])
  })
})
