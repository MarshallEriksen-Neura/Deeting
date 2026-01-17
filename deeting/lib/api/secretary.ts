import { z } from "zod"

import { request } from "@/lib/http"

const USERS_BASE = "/api/v1/users"

export const UserSecretarySchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  current_phase_id: z.string().uuid(),
  name: z.string(),
  model_name: z.string().nullable().optional(),
  embedding_model: z.string().nullable().optional(),
  topic_naming_model: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
})

export type UserSecretary = z.infer<typeof UserSecretarySchema>

export const UserSecretaryUpdateSchema = z.object({
  model_name: z.string().nullable().optional(),
  embedding_model: z.string().nullable().optional(),
  topic_naming_model: z.string().nullable().optional(),
})

export type UserSecretaryUpdate = z.infer<typeof UserSecretaryUpdateSchema>

export async function fetchUserSecretary(): Promise<UserSecretary> {
  const data = await request<UserSecretary>({
    url: `${USERS_BASE}/me/secretary`,
    method: "GET",
  })
  return UserSecretarySchema.parse(data)
}

export async function updateUserSecretary(
  payload: UserSecretaryUpdate
): Promise<UserSecretary> {
  const data = await request<UserSecretary>({
    url: `${USERS_BASE}/me/secretary`,
    method: "PATCH",
    data: payload,
  })
  return UserSecretarySchema.parse(data)
}
