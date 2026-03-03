import { z } from "zod"

export const UserEmbeddingConfigSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  provider_model_id: z.string().uuid().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
})

export type UserEmbeddingConfig = z.infer<typeof UserEmbeddingConfigSchema>

export const UserEmbeddingConfigUpdateSchema = z.object({
  provider_model_id: z.string().uuid().nullable().optional(),
})

export type UserEmbeddingConfigUpdate = z.infer<typeof UserEmbeddingConfigUpdateSchema>

const isTauriRuntime = () =>
  process.env.NEXT_PUBLIC_IS_TAURI === "true" &&
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<T>(command, args)
}

function assertDesktopRuntime() {
  if (!isTauriRuntime()) {
    throw new Error("user embedding config is only available in desktop runtime")
  }
}

export async function fetchUserEmbeddingConfig(): Promise<UserEmbeddingConfig> {
  assertDesktopRuntime()
  const data = await invokeTauri<UserEmbeddingConfig>("get_local_user_embedding_config")
  return UserEmbeddingConfigSchema.parse(data)
}

export async function updateUserEmbeddingConfig(
  payload: UserEmbeddingConfigUpdate
): Promise<UserEmbeddingConfig> {
  assertDesktopRuntime()
  const normalizedPayload = UserEmbeddingConfigUpdateSchema.parse(payload)
  const data = await invokeTauri<UserEmbeddingConfig>("update_local_user_embedding_config", {
    payload: {
      provider_model_id: normalizedPayload.provider_model_id,
    },
  })
  return UserEmbeddingConfigSchema.parse(data)
}
