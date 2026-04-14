import { z } from "zod"

const isTauriRuntime = () =>
  process.env.NEXT_PUBLIC_IS_TAURI === "true" &&
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<T>(command, args)
}

function ensureTauriRuntime() {
  if (!isTauriRuntime()) {
    throw new Error("task learning inspector is only supported in Tauri runtime")
  }
}

const JsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ])
)

export const TaskLearningRunListItemSchema = z.object({
  run_id: z.string(),
  session_id: z.string(),
  request_id: z.string().nullable().optional(),
  trace_id: z.string().nullable().optional(),
  fingerprint_key: z.string(),
  decision_point: z.string().nullable().optional(),
  learning_eligible: z.boolean(),
  delta_state: z.string(),
  final_status: z.string().nullable().optional(),
  verification_result: z.string().nullable().optional(),
  user_response_signal: z.string().nullable().optional(),
  confidence: z.number().nullable().optional(),
  revision_count: z.number().int().default(0),
  last_signal: z.string().nullable().optional(),
  created_at_unix_ms: z.number().int(),
  last_revision_at_unix_ms: z.number().int().nullable().optional(),
})

export const TaskLearningRunListResponseSchema = z.object({
  total: z.number().int(),
  skip: z.number().int(),
  limit: z.number().int(),
  items: z.array(TaskLearningRunListItemSchema).default([]),
})

export const TaskLearningRevisionItemSchema = z.object({
  id: z.string(),
  run_id: z.string(),
  revision_index: z.number().int(),
  trigger_source: z.string(),
  user_response_signal: z.string(),
  note: z.string().nullable().optional(),
  outcome: JsonValueSchema,
  attribution: JsonValueSchema,
  policy_delta: JsonValueSchema.nullable().optional(),
  delta_state: z.string(),
  created_at_unix_ms: z.number().int(),
})

export const TraceFeedbackSchema = z.object({
  id: z.string(),
  trace_id: z.string(),
  user_id: z.string().nullable().optional(),
  score: z.number(),
  comment: z.string().nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
})

export const TaskLearningRunDetailSchema = z.object({
  run_id: z.string(),
  session_id: z.string(),
  request_id: z.string().nullable().optional(),
  trace_id: z.string().nullable().optional(),
  fingerprint_key: z.string(),
  task_fingerprint: JsonValueSchema,
  route_decision: JsonValueSchema.nullable().optional(),
  execution_policy: JsonValueSchema,
  outcome: JsonValueSchema,
  attribution: JsonValueSchema,
  policy_delta: JsonValueSchema.nullable().optional(),
  learning_eligible: z.boolean(),
  delta_state: z.string(),
  revision_count: z.number().int(),
  last_signal: z.string().nullable().optional(),
  created_at_unix_ms: z.number().int(),
  last_revision_at_unix_ms: z.number().int().nullable().optional(),
  revisions: z.array(TaskLearningRevisionItemSchema).default([]),
  trace_feedback: z.array(TraceFeedbackSchema).default([]),
})

export const TaskPolicyPriorItemSchema = z.object({
  fingerprint_key: z.string(),
  decision_point: z.string(),
  action_key: z.string(),
  weight: z.number(),
  confidence: z.number(),
  evidence_count: z.number().int(),
  maturity: z.string(),
  updated_at_unix_ms: z.number().int(),
})

export const TaskPolicyPriorListResponseSchema = z.object({
  total: z.number().int(),
  skip: z.number().int(),
  limit: z.number().int(),
  items: z.array(TaskPolicyPriorItemSchema).default([]),
})

export type TaskLearningRunListItem = z.infer<typeof TaskLearningRunListItemSchema>
export type TaskLearningRunListResponse = z.infer<typeof TaskLearningRunListResponseSchema>
export type TaskLearningRunDetail = z.infer<typeof TaskLearningRunDetailSchema>
export type TaskPolicyPriorListResponse = z.infer<typeof TaskPolicyPriorListResponseSchema>

export type TaskLearningRunQuery = {
  skip?: number
  limit?: number
  session_id?: string | null
  fingerprint_key?: string | null
  decision_point?: string | null
  user_response_signal?: string | null
  learning_eligible?: boolean | null
}

export async function listTaskLearningRuns(
  query: TaskLearningRunQuery = {}
): Promise<TaskLearningRunListResponse> {
  ensureTauriRuntime()
  const data = await invokeTauri<unknown>("list_local_task_learning_runs", { query })
  return TaskLearningRunListResponseSchema.parse(data)
}

export async function getTaskLearningRun(runId: string): Promise<TaskLearningRunDetail> {
  ensureTauriRuntime()
  const data = await invokeTauri<unknown>("get_local_task_learning_run", { runId })
  return TaskLearningRunDetailSchema.parse(data)
}

export async function listTaskPolicyPriors(query: {
  skip?: number
  limit?: number
  fingerprint_key?: string | null
  decision_point?: string | null
} = {}): Promise<TaskPolicyPriorListResponse> {
  ensureTauriRuntime()
  const data = await invokeTauri<unknown>("list_local_task_policy_priors", { query })
  return TaskPolicyPriorListResponseSchema.parse(data)
}

export async function reviseTaskLearningRun(payload: {
  run_id: string
  user_response_signal: string
  note?: string | null
  trigger_source?: string | null
}): Promise<TaskLearningRunDetail> {
  ensureTauriRuntime()
  const data = await invokeTauri<unknown>("revise_local_task_learning_run", {
    payload: {
      run_id: payload.run_id,
      user_response_signal: payload.user_response_signal,
      note: payload.note ?? null,
      trigger_source: payload.trigger_source ?? null,
    },
  })
  return TaskLearningRunDetailSchema.parse(data)
}

export async function replayTaskLearningRun(payload: {
  run_id: string
  note?: string | null
}): Promise<TaskLearningRunDetail> {
  ensureTauriRuntime()
  const data = await invokeTauri<unknown>("replay_local_task_learning_run", {
    payload: {
      run_id: payload.run_id,
      note: payload.note ?? null,
    },
  })
  return TaskLearningRunDetailSchema.parse(data)
}
