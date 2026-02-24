import { z } from "zod"

import { request } from "@/lib/http"

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
  render_blocks: z.record(z.any()).default({}),
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

// ── API functions ───────────────────────────────────────────

export async function fetchCodeModeExecutions(
  query: CodeModeExecutionsQuery = {}
): Promise<CodeModeExecutionPage> {
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
  return request({
    url: `${INTERNAL_CODE_MODE_BASE}/executions/${identifier}/replay`,
    method: "POST",
    data: payload,
  })
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
