import { z } from "zod"

const isTauriRuntime = () =>
  process.env.NEXT_PUBLIC_IS_TAURI === "true" &&
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<T>(command, args)
}

export const LocalModelPoolSessionBindingSchema = z.object({
  session_id: z.string(),
  title: z.string().nullable().optional(),
  pinned_provider_model_id: z.string(),
  last_active_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const LocalModelPoolMemberStatusSchema = z.object({
  provider_model_id: z.string(),
  instance_id: z.string(),
  instance_name: z.string(),
  provider: z.string().nullable().optional(),
  model_id: z.string(),
  unified_model_id: z.string().nullable().optional(),
  display_name: z.string().nullable().optional(),
  status: z.string(),
  success_rate: z.number().nullable().optional(),
  avg_latency_ms: z.number().nullable().optional(),
  total_trials: z.number(),
  successes: z.number(),
  failures: z.number(),
  cooldown_until: z.string().nullable().optional(),
  is_pinned: z.boolean(),
  pinned_session_count: z.number(),
})

export const LocalModelPoolStatusSchema = z.object({
  pool_key: z.string(),
  display_name: z.string(),
  provider_count: z.number(),
  active_provider_count: z.number(),
  cooling_down_count: z.number(),
  active_session_count: z.number(),
  health_score: z.number(),
  success_rate: z.number().nullable().optional(),
  avg_latency_ms: z.number().nullable().optional(),
  members: z.array(LocalModelPoolMemberStatusSchema),
  bindings: z.array(LocalModelPoolSessionBindingSchema),
})

export type LocalModelPoolSessionBinding = z.infer<typeof LocalModelPoolSessionBindingSchema>
export type LocalModelPoolMemberStatus = z.infer<typeof LocalModelPoolMemberStatusSchema>
export type LocalModelPoolStatus = z.infer<typeof LocalModelPoolStatusSchema>

export async function fetchLocalModelPoolsStatus(): Promise<LocalModelPoolStatus[]> {
  if (!isTauriRuntime()) {
    return []
  }

  const payload = await invokeTauri<unknown[]>("list_local_model_pools_status")
  return z.array(LocalModelPoolStatusSchema).parse(payload)
}
