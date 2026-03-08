import { z } from "zod"

import { request } from "@/lib/http"

const isTauriRuntime = () =>
  process.env.NEXT_PUBLIC_IS_TAURI === "true" &&
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<T>(command, args)
}

// ── Constants ────────────────────────────────────────────────
const INTERNAL_CODE_MODE_BASE = "/api/v1/internal/code-mode"

// ── Schema: list item (lightweight) ─────────────────────────
export const CodeModeExecutionItemSchema = z.object({
  id: z.string(),
  execution_id: z.string(),
  session_id: z.string(),
  language: z.string(),
  status: z.string(),
  error: z.string().nullable().optional(),
  error_code: z.string().nullable().optional(),
  duration_ms: z.number(),
  tool_call_count: z.number(),
  created_at: z.string().nullable(),
})

export type CodeModeExecutionItem = z.infer<typeof CodeModeExecutionItemSchema>

// ── Schema: full detail ─────────────────────────────────────
export const CodeModeExecutionDetailSchema = z.object({
  id: z.string(),
  execution_id: z.string(),
  user_id: z.string(),
  session_id: z.string(),
  trace_id: z.string().nullable().optional(),
  language: z.string(),
  status: z.string(),
  format_version: z.string().nullable().optional(),
  runtime_protocol_version: z.string().nullable().optional(),
  runtime_context: z.record(z.any()).default({}),
  tool_plan_results: z.record(z.any()).default({}),
  runtime_tool_calls: z.record(z.any()).default({}),
  render_blocks: z.union([z.record(z.any()), z.array(z.any())]).default({}),
  error: z.string().nullable().optional(),
  error_code: z.string().nullable().optional(),
  duration_ms: z.number(),
  request_meta: z.record(z.any()).default({}),
  created_at: z.string().nullable(),
})

export type CodeModeExecutionDetail = z.infer<typeof CodeModeExecutionDetailSchema>

// ── Schema: runtime tool trace entry ────────────────────────
export const RuntimeToolTraceSchema = z.object({
  tool_name: z.string(),
  arguments: z.record(z.any()).optional(),
  result: z.any().optional(),
  error: z.string().nullable().optional(),
  duration_ms: z.number().optional(),
  call_index: z.number().optional(),
})

export type RuntimeToolTrace = z.infer<typeof RuntimeToolTraceSchema>

const LocalRuntimeToolCallSchema = z.object({
  index: z.number().optional(),
  tool_name: z.string().nullable().optional(),
  arguments: z.record(z.any()).optional(),
})

// ── Query params ────────────────────────────────────────────
export type CodeModeExecutionsQuery = {
  cursor?: string | null
  size?: number
  status?: string
  session_id?: string
}

// ── Page response ───────────────────────────────────────────
export const CodeModeExecutionPageSchema = z.object({
  items: z.array(CodeModeExecutionItemSchema),
  next_page: z.string().nullable(),
  previous_page: z.string().nullable(),
})

export type CodeModeExecutionPage = z.infer<typeof CodeModeExecutionPageSchema>

export const LocalCodeModeBridgeStatusSchema = z.object({
  running: z.boolean(),
  base_url: z.string().nullable().optional(),
})

export type LocalCodeModeBridgeStatus = z.infer<typeof LocalCodeModeBridgeStatusSchema>

export const ExecuteLocalCodeModeResponseSchema = z.object({
  success: z.boolean(),
  status: z.string(),
  format_version: z.string(),
  runtime_protocol_version: z.string(),
  session_id: z.string(),
  bridge_endpoint: z.string(),
  exit_code: z.number(),
  stdout: z.array(z.string()).default([]),
  stderr: z.array(z.string()).default([]),
  result: z.array(z.string()).default([]),
  runtime_tool_calls: z.array(LocalRuntimeToolCallSchema).default([]),
  render_blocks: z.array(z.any()).default([]),
  error: z.string().nullable().optional(),
})

export type ExecuteLocalCodeModeResponse = z.infer<
  typeof ExecuteLocalCodeModeResponseSchema
>

// ── API functions ───────────────────────────────────────────

export async function fetchCodeModeExecutions(
  query: CodeModeExecutionsQuery = {}
): Promise<CodeModeExecutionPage> {
  if (isTauriRuntime()) {
    const data = await invokeTauri<unknown>("list_local_code_mode_executions", {
      query: {
        cursor: query.cursor ?? null,
        size: query.size ?? 20,
        status: query.status ?? null,
        session_id: query.session_id ?? null,
      },
    })
    return CodeModeExecutionPageSchema.parse(data)
  }

  const data = await request({
    url: `${INTERNAL_CODE_MODE_BASE}/executions`,
    method: "GET",
    params: query,
  })
  return CodeModeExecutionPageSchema.parse(data)
}

export async function fetchCodeModeExecution(
  identifier: string
): Promise<CodeModeExecutionDetail> {
  if (isTauriRuntime()) {
    const data = await invokeTauri<unknown>("get_local_code_mode_execution", {
      executionIdentifier: identifier,
    })
    return CodeModeExecutionDetailSchema.parse(data)
  }

  const data = await request({
    url: `${INTERNAL_CODE_MODE_BASE}/executions/${identifier}`,
    method: "GET",
  })
  return CodeModeExecutionDetailSchema.parse(data)
}

export async function replayCodeModeExecution(
  identifier: string,
  payload: {
    code?: string | null
    session_id?: string | null
    language?: string
    execution_timeout?: number
    dry_run?: boolean
    tool_plan?: Array<Record<string, unknown>> | null
  } = {}
): Promise<Record<string, unknown>> {
  if (isTauriRuntime()) {
    return invokeTauri<Record<string, unknown>>("replay_local_code_mode_execution", {
      executionIdentifier: identifier,
      payload,
    })
  }

  return request({
    url: `${INTERNAL_CODE_MODE_BASE}/executions/${identifier}/replay`,
    method: "POST",
    data: payload,
  })
}

export async function getLocalCodeModeBridgeStatus(): Promise<LocalCodeModeBridgeStatus> {
  if (!isTauriRuntime()) {
    return { running: false, base_url: null }
  }
  const data = await invokeTauri<unknown>("get_local_code_mode_bridge_status")
  return LocalCodeModeBridgeStatusSchema.parse(data)
}

export async function executeLocalCodeMode(payload: {
  code: string
  session_id?: string | null
  language?: string
  execution_timeout?: number
  dry_run?: boolean
  context?: Record<string, unknown> | null
  max_calls?: number
}): Promise<ExecuteLocalCodeModeResponse> {
  if (!isTauriRuntime()) {
    throw new Error("executeLocalCodeMode is only supported in Tauri runtime")
  }
  const data = await invokeTauri<unknown>("execute_local_code_mode", {
    payload: {
      code: payload.code,
      session_id: payload.session_id ?? null,
      language: payload.language ?? "python",
      execution_timeout: payload.execution_timeout ?? 30,
      dry_run: payload.dry_run ?? false,
      context: payload.context ?? null,
      max_calls: payload.max_calls ?? 16,
    },
  })
  return ExecuteLocalCodeModeResponseSchema.parse(data)
}

/**
 * Extract runtime tool traces from a detail record's runtime_tool_calls field.
 */
export function extractToolTraces(
  detail: CodeModeExecutionDetail
): RuntimeToolTrace[] {
  const rtc = detail.runtime_tool_calls
  if (!rtc || typeof rtc !== "object") return []
  const calls = rtc.calls
  if (!Array.isArray(calls)) return []
  return calls.map((c: unknown) => {
    try {
      return RuntimeToolTraceSchema.parse(c)
    } catch {
      return c as RuntimeToolTrace
    }
  })
}
