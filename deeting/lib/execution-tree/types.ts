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

export type ExecutionTreeResultPayload = {
  render_blocks?: ExecutionTreeRenderBlock[]
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
  result_payload?: ExecutionTreeResultPayload
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

export function buildExecutionLifecyclePayloadFromPersistedTree(
  tree: ConversationExecutionTree
): ExecutionLifecyclePayload {
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
    result_payload:
      tree.root.result_payload && typeof tree.root.result_payload === "object"
        ? (tree.root.result_payload as ExecutionTreeResultPayload)
        : null,
    children: tree.children.map((child) => ({
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
    })),
  }
}
