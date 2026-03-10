import { z } from "zod"

import { request } from "@/lib/http"

const USERS_BASE = "/api/v1/users"
const isTauriRuntime = () =>
  process.env.NEXT_PUBLIC_IS_TAURI === "true" &&
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<T>(command, args)
}

export const UserSecretarySchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  name: z.string(),
  // Legacy/back-compat model reference. Desktop should prefer provider_model_id.
  model_name: z.string().nullable().optional(),
  provider_model_id: z.string().uuid().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
})

export type UserSecretary = z.infer<typeof UserSecretarySchema>

export const UserSecretaryUpdateSchema = z.object({
  // Legacy/back-compat model reference. Keep sending it for older stores.
  model_name: z.string().nullable().optional(),
  provider_model_id: z.string().uuid().nullable().optional(),
})

export type UserSecretaryUpdate = z.infer<typeof UserSecretaryUpdateSchema>

export async function fetchUserSecretary(): Promise<UserSecretary> {
  if (isTauriRuntime()) {
    const data = await invokeTauri<UserSecretary>("get_local_user_secretary")
    return UserSecretarySchema.parse(data)
  }

  const data = await request<UserSecretary>({
    url: `${USERS_BASE}/me/secretary`,
    method: "GET",
  })
  return UserSecretarySchema.parse(data)
}

export async function updateUserSecretary(
  payload: UserSecretaryUpdate
): Promise<UserSecretary> {
  const normalizedPayload = UserSecretaryUpdateSchema.parse(payload)
  if (isTauriRuntime()) {
    const data = await invokeTauri<UserSecretary>("update_local_user_secretary", {
      payload: {
        model_name: normalizedPayload.model_name,
        provider_model_id: normalizedPayload.provider_model_id,
      },
    })
    return UserSecretarySchema.parse(data)
  }

  const data = await request<UserSecretary>({
    url: `${USERS_BASE}/me/secretary`,
    method: "PATCH",
    data: normalizedPayload,
  })
  return UserSecretarySchema.parse(data)
}
