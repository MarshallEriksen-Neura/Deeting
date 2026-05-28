import { z } from "zod"

const isTauriRuntime = () =>
  process.env.NEXT_PUBLIC_IS_TAURI === "true" &&
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<T>(command, args)
}

export const KNOWN_BANDIT_SCENES = [
  "router:llm",
  "task_learning:worker_selection",
  "memory:recall",
] as const

export type KnownBanditScene = (typeof KNOWN_BANDIT_SCENES)[number]

export const LocalBanditArmStateSchema = z.object({
  id: z.string(),
  provider_model_id: z.string().nullable().optional(),
  scene: z.string(),
  arm_id: z.string().nullable().optional(),
  reward_metric_type: z.string().nullable().optional(),
  strategy: z.string(),
  epsilon: z.number(),
  alpha: z.number(),
  beta: z.number(),
  total_trials: z.number(),
  successes: z.number(),
  failures: z.number(),
  total_latency_ms: z.number(),
  latency_p95_ms: z.number().nullable().optional(),
  total_cost: z.number(),
  last_reward: z.number(),
  cooldown_until: z.string().nullable().optional(),
  version: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
})

export type LocalBanditArmState = z.infer<typeof LocalBanditArmStateSchema>

export type LocalBanditSceneSnapshot = {
  scene: KnownBanditScene
  arms: LocalBanditArmState[]
}

export async function fetchLocalBanditArmStates(
  scene: KnownBanditScene
): Promise<LocalBanditArmState[]> {
  if (!isTauriRuntime()) {
    return []
  }

  const payload = await invokeTauri<unknown[]>("list_local_bandit_arm_states", { scene })
  return z.array(LocalBanditArmStateSchema).parse(payload)
}

export async function fetchLocalBanditDashboard(): Promise<LocalBanditSceneSnapshot[]> {
  const snapshots = await Promise.all(
    KNOWN_BANDIT_SCENES.map(async (scene) => ({
      scene,
      arms: await fetchLocalBanditArmStates(scene),
    }))
  )

  return snapshots
}
