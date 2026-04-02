import type { MessageBlock } from "@/lib/chat/message-protocol"
import type { Message, MessageMetaInfo } from "@/lib/chat/message-types"
import type { ExecutionLifecyclePayload } from "@/lib/execution-tree/types"

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null
  return value as Record<string, unknown>
}

function asTrimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

export function extractExecutionTreeBlockFromBlocks(
  blocks: MessageBlock[]
): MessageBlock | null {
  for (const block of blocks) {
    if (block.type !== "ui") continue
    if (typeof block.viewType !== "string") continue
    if (block.viewType.trim() !== "execution.lifecycle") continue
    return block
  }
  return null
}

export function extractRootExecutionIdFromBlock(
  block: MessageBlock | null | undefined
): string | null {
  if (!block || block.type !== "ui") return null
  if (typeof block.viewType !== "string" || block.viewType.trim() !== "execution.lifecycle") {
    return null
  }
  return extractRootExecutionIdFromExecutionTree(asRecord(block.payload))
}

export function extractExecutionTreeFromMessage(
  message: Pick<Message, "blocks" | "metaInfo">
): Record<string, unknown> | null {
  const blocks = Array.isArray(message.blocks) ? message.blocks : []
  const executionBlock = extractExecutionTreeBlockFromBlocks(blocks)
  if (executionBlock?.type === "ui") {
    return asRecord(executionBlock.payload)
  }

  const metaInfo = message.metaInfo as MessageMetaInfo | undefined
  return asRecord(metaInfo?.execution_tree)
}

export function extractWorkflowRunIdFromExecutionTree(
  executionTree: Record<string, unknown> | null
): string | null {
  if (!executionTree) return null
  const target = asRecord(executionTree.target)
  return asTrimmedString(target?.workflow_run_id)
}

export function extractWorkflowRunIdFromMessage(
  message: Pick<Message, "blocks" | "metaInfo">
): string | null {
  return extractWorkflowRunIdFromExecutionTree(extractExecutionTreeFromMessage(message))
}

export function extractRootExecutionIdFromExecutionTree(
  executionTree: Record<string, unknown> | null
): string | null {
  if (!executionTree) return null
  return asTrimmedString(executionTree.root_execution_id)
}

export function extractExecutionTreeSchemaVersion(
  executionTree: Record<string, unknown> | null
): number | null {
  if (!executionTree) return null
  return typeof executionTree.schema_version === "number"
    ? executionTree.schema_version
    : null
}

export function findExecutionTreeByRootId(
  messages: Array<Pick<Message, "blocks" | "metaInfo">>,
  rootExecutionId: string
): Record<string, unknown> | null {
  const normalizedRootId = asTrimmedString(rootExecutionId)
  if (!normalizedRootId) return null

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const executionTree = extractExecutionTreeFromMessage(messages[index]!)
    if (!executionTree) continue
    if (extractRootExecutionIdFromExecutionTree(executionTree) === normalizedRootId) {
      return executionTree
    }
  }

  return null
}

export function buildExecutionLifecycleBlock(
  executionTree: Record<string, unknown>,
  options: {
    id: string
    title?: string
    displayMode?: "bubble" | "widget" | "canvas"
    streamState?: "streaming" | "completed"
  }
): MessageBlock {
  const target = asRecord(executionTree.target)
  const targetName =
    typeof target?.name === "string" && target.name.trim().length > 0
      ? target.name.trim()
      : "Delegated Execution"
  const workflowRunId = extractWorkflowRunIdFromExecutionTree(executionTree)
  const metadata: Record<string, unknown> = {}
  if (workflowRunId) {
    metadata.workflow_run_id = workflowRunId
  }
  if (typeof target?.worker_ref === "string" && target.worker_ref.trim()) {
    metadata.worker_ref = target.worker_ref.trim()
  }

  return {
    id: options.id,
    type: "ui",
    viewType: "execution.lifecycle",
    payload: executionTree,
    title: options.title ?? `Delegated Execution · ${targetName}`,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    displayMode: options.displayMode ?? "widget",
    streamState: options.streamState ?? "completed",
  } as MessageBlock
}

export function buildExecutionLifecycleBlocksFromMessage(
  message: Pick<Message, "blocks" | "metaInfo">,
  options: {
    id: string
    title?: string
    displayMode?: "bubble" | "widget" | "canvas"
    streamState?: "streaming" | "completed"
  }
): MessageBlock[] {
  const executionTree = extractExecutionTreeFromMessage(message)
  if (!executionTree) return []
  return [buildExecutionLifecycleBlock(executionTree, options)]
}

export function applyPersistedExecutionTreeToMessage(
  message: Message,
  executionTree: ExecutionLifecyclePayload
): Message {
  const nextMetaInfo = {
    ...(message.metaInfo ?? {}),
    execution_tree: executionTree,
  }

  const executionBlock = buildExecutionLifecycleBlock(
    executionTree as Record<string, unknown>,
    {
      id: `${message.id}-execution-tree`,
      title: "Delegated Execution",
      displayMode: "bubble",
      streamState: "completed",
    }
  )

  const existingBlocks = Array.isArray(message.blocks) ? [...message.blocks] : []
  const nextBlocks =
    existingBlocks.length === 0
      ? [executionBlock]
      : (() => {
          const rootExecutionId = extractRootExecutionIdFromBlock(executionBlock)
          if (!rootExecutionId) {
            return [...existingBlocks, executionBlock]
          }
          const existingIndex = existingBlocks.findIndex(
            (block) => extractRootExecutionIdFromBlock(block) === rootExecutionId
          )
          if (existingIndex < 0) {
            return [...existingBlocks, executionBlock]
          }
          const existing = existingBlocks[existingIndex]
          existingBlocks[existingIndex] = {
            ...existing,
            ...executionBlock,
            id: existing.id || executionBlock.id,
          }
          return existingBlocks
        })()

  return {
    ...message,
    metaInfo: nextMetaInfo,
    blocks: nextBlocks,
  }
}
