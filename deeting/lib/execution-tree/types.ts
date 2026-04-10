"use client"

import type { ConversationExecutionTree } from "@/lib/api/conversations"

export type ExecutionTreeAction = {
  kind?: string | null
}

export type ExecutionTreeTarget = {
  id?: string | null
  name?: string | null
  invocation_kind?: string | null
  worker_ref?: string | null
  workflow_run_id?: string | null
}

export type ExecutionTreeRenderBlock = {
  view_type?: string | null
  payload?: unknown
  title?: string | null
  metadata?: Record<string, unknown> | null
}

export type ExecutionTreePrimaryOutput = ({
  render_blocks?: ExecutionTreeRenderBlock[]
} & Record<string, unknown>) | null

export type DelegatedResultPayload = {
  type?: string | null
  schema_version?: number | null
  kind?: string | null
  authoritative?: boolean | null
  status?: string | null
  execution_id?: string | null
  target?: ExecutionTreeTarget
  selection?: {
    explicit?: boolean
    score?: number | null
    reason_codes?: string[]
    reason_text?: string | null
  }
  available_actions?: ExecutionTreeAction[]
  summary?: string | null
  steps?: ExecutionTreeChild[]
  primary_output?: ExecutionTreePrimaryOutput
  error?: string | null
} | null

export type ExecutionTreeChild = {
  id?: string | null
  phase_id?: string | null
  step_type?: string | null
  title?: string | null
  status?: string | null
  worker_ref?: string | null
  summary?: string | null
  error?: string | null
  available_actions?: ExecutionTreeAction[]
}

export type ExecutionLifecyclePayload = {
  schema_version?: number
  root_execution_id?: string
  execution_id?: string
  execution_kind?: string
  execution_status?: string
  terminal_status?: string
  persisted_snapshot?: boolean
  target?: ExecutionTreeTarget
  selection?: {
    explicit?: boolean
    score?: number | null
    reason_codes?: string[]
    reason_text?: string | null
  }
  available_actions?: ExecutionTreeAction[]
  summary?: string | null
  error?: string | null
  delegated_result?: DelegatedResultPayload
  children?: ExecutionTreeChild[]
}

export function asExecutionLifecyclePayload(data: unknown): ExecutionLifecyclePayload {
  return typeof data === "object" && data !== null ? (data as ExecutionLifecyclePayload) : {}
}

export function asActionList(value: unknown): ExecutionTreeAction[] {
  return Array.isArray(value) ? (value as ExecutionTreeAction[]) : []
}

export function asChildList(value: unknown): ExecutionTreeChild[] {
  return Array.isArray(value) ? (value as ExecutionTreeChild[]) : []
}

export function asRenderBlockList(value: unknown): ExecutionTreeRenderBlock[] {
  return Array.isArray(value) ? (value as ExecutionTreeRenderBlock[]) : []
}

export function toText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export function asDelegatedResultPayload(value: unknown): DelegatedResultPayload {
  return asRecord(value) as DelegatedResultPayload
}

export function getExecutionLifecycleDelegatedResult(
  payload: ExecutionLifecyclePayload
): DelegatedResultPayload {
  const delegatedResult = asDelegatedResultPayload(payload.delegated_result)
  if (delegatedResult) return delegatedResult

  const legacyPrimaryOutput = asRecord((payload as { result_payload?: unknown }).result_payload)
  return {
    type: "delegated_result",
    schema_version: typeof payload.schema_version === "number" ? payload.schema_version : 1,
    kind: payload.execution_kind,
    authoritative: payload.terminal_status === "succeeded",
    status: payload.terminal_status ?? payload.execution_status,
    execution_id: payload.execution_id,
    target: payload.target,
    selection: payload.selection,
    available_actions: Array.isArray(payload.available_actions) ? payload.available_actions : [],
    summary: payload.summary ?? undefined,
    steps: Array.isArray(payload.children) ? payload.children : [],
    primary_output: legacyPrimaryOutput as ExecutionTreePrimaryOutput,
    error: payload.error ?? undefined,
  }
}

export function getExecutionLifecycleTarget(payload: ExecutionLifecyclePayload): ExecutionTreeTarget {
  return getExecutionLifecycleDelegatedResult(payload)?.target ?? payload.target ?? {}
}

export function getExecutionLifecycleKind(payload: ExecutionLifecyclePayload): string | null {
  return (
    toText(getExecutionLifecycleDelegatedResult(payload)?.kind) ?? toText(payload.execution_kind)
  )
}

export function getExecutionLifecycleSelection(
  payload: ExecutionLifecyclePayload
): NonNullable<ExecutionLifecyclePayload["selection"]> | undefined {
  return getExecutionLifecycleDelegatedResult(payload)?.selection ?? payload.selection
}

export function getExecutionLifecycleAvailableActions(
  payload: ExecutionLifecyclePayload
): ExecutionTreeAction[] {
  const delegatedActions = getExecutionLifecycleDelegatedResult(payload)?.available_actions
  if (Array.isArray(delegatedActions)) return delegatedActions
  return Array.isArray(payload.available_actions) ? payload.available_actions : []
}

export function getExecutionLifecycleSummary(payload: ExecutionLifecyclePayload): string | null {
  return (
    toText(getExecutionLifecycleDelegatedResult(payload)?.summary) ?? toText(payload.summary)
  )
}

export function getExecutionLifecycleError(payload: ExecutionLifecyclePayload): string | null {
  return toText(getExecutionLifecycleDelegatedResult(payload)?.error) ?? toText(payload.error)
}

export function getExecutionLifecycleChildren(
  payload: ExecutionLifecyclePayload
): ExecutionTreeChild[] {
  const delegatedSteps = getExecutionLifecycleDelegatedResult(payload)?.steps
  if (Array.isArray(delegatedSteps)) return delegatedSteps
  return Array.isArray(payload.children) ? payload.children : []
}

export function getExecutionLifecyclePrimaryOutput(
  payload: ExecutionLifecyclePayload
): ExecutionTreePrimaryOutput {
  const delegatedPrimaryOutput = getExecutionLifecycleDelegatedResult(payload)?.primary_output
  if (delegatedPrimaryOutput && typeof delegatedPrimaryOutput === "object") {
    return delegatedPrimaryOutput
  }
  return asRecord((payload as { result_payload?: unknown }).result_payload) as ExecutionTreePrimaryOutput
}

export function buildExecutionLifecyclePayloadFromPersistedTree(
  tree: ConversationExecutionTree
): ExecutionLifecyclePayload {
  const rawPayload = asRecord(tree.root.raw_json)
  const persistedChildren = tree.children.map((child) => ({
    id: child.id,
    phase_id: child.phase_id ?? undefined,
    step_type: child.step_type ?? undefined,
    title: child.title,
    status: child.status,
    worker_ref: child.worker_ref ?? undefined,
    summary: child.summary ?? undefined,
    error: child.error ?? undefined,
    available_actions: Array.isArray(child.available_actions)
      ? (child.available_actions as ExecutionTreeAction[])
      : [],
  }))
  const legacyPrimaryOutput =
    tree.root.result_payload && typeof tree.root.result_payload === "object"
      ? (tree.root.result_payload as ExecutionTreePrimaryOutput)
      : null
  const delegatedResult =
    asRecord(rawPayload?.delegated_result) ??
    ({
      type: "delegated_result",
      schema_version: 1,
      kind: tree.root.execution_kind,
      authoritative: tree.root.terminal_status === "succeeded",
      status: tree.root.terminal_status,
      execution_id: tree.root.execution_id,
      target: {
        id: tree.root.target_id ?? undefined,
        name: tree.root.target_name ?? undefined,
        invocation_kind: tree.root.target_invocation_kind ?? undefined,
        worker_ref: tree.root.target_worker_ref ?? undefined,
        workflow_run_id: tree.root.target_workflow_run_id ?? undefined,
      },
      selection:
        tree.root.selection && typeof tree.root.selection === "object"
          ? {
              explicit:
                typeof tree.root.selection.explicit === "boolean"
                  ? tree.root.selection.explicit
                  : undefined,
              score:
                typeof tree.root.selection.score === "number"
                  ? tree.root.selection.score
                  : null,
              reason_codes: Array.isArray(tree.root.selection.reason_codes)
                ? (tree.root.selection.reason_codes as string[])
                : undefined,
              reason_text:
                typeof tree.root.selection.reason_text === "string"
                  ? tree.root.selection.reason_text
                  : null,
            }
          : undefined,
      available_actions: Array.isArray(tree.root.available_actions)
        ? (tree.root.available_actions as ExecutionTreeAction[])
        : [],
      summary: tree.root.summary ?? undefined,
      steps: persistedChildren,
      primary_output: legacyPrimaryOutput,
      error: tree.root.error ?? undefined,
    } satisfies Record<string, unknown>)

  return {
    schema_version: tree.root.schema_version,
    root_execution_id: tree.root.root_execution_id,
    execution_id: tree.root.execution_id,
    execution_kind: tree.root.execution_kind,
    execution_status: tree.root.execution_status,
    terminal_status: tree.root.terminal_status,
    persisted_snapshot: true,
    target: {
      id: tree.root.target_id ?? undefined,
      name: tree.root.target_name ?? undefined,
      invocation_kind: tree.root.target_invocation_kind ?? undefined,
      worker_ref: tree.root.target_worker_ref ?? undefined,
      workflow_run_id: tree.root.target_workflow_run_id ?? undefined,
    },
    selection:
      tree.root.selection && typeof tree.root.selection === "object"
        ? {
            explicit:
              typeof tree.root.selection.explicit === "boolean"
                ? tree.root.selection.explicit
                : undefined,
            score:
              typeof tree.root.selection.score === "number"
                ? tree.root.selection.score
                : null,
            reason_codes: Array.isArray(tree.root.selection.reason_codes)
              ? (tree.root.selection.reason_codes as string[])
              : undefined,
            reason_text:
              typeof tree.root.selection.reason_text === "string"
                ? tree.root.selection.reason_text
                : null,
          }
        : undefined,
    available_actions: Array.isArray(tree.root.available_actions)
      ? (tree.root.available_actions as ExecutionTreeAction[])
      : [],
    summary: tree.root.summary ?? undefined,
    error: tree.root.error ?? undefined,
    delegated_result: delegatedResult as DelegatedResultPayload,
    children: persistedChildren,
  }
}
