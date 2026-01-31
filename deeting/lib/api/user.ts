import { z } from "zod"

import { request } from "@/lib/http"

const USER_BASE = "/api/v1/users"

export const PermissionFlagsSchema = z.record(z.string(), z.number().int())

export const UserProfileSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  username: z.string().nullable(),
  avatar_url: z.string().nullable(),
  is_active: z.boolean(),
  is_superuser: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
  permission_flags: PermissionFlagsSchema,
})

export type UserProfile = z.infer<typeof UserProfileSchema>

export type UserUpdateRequest = {
  username?: string
  avatar_object_key?: string
  avatar_storage_type?: string
}

export async function fetchCurrentUser(): Promise<UserProfile> {
  const data = await request<UserProfile>({
    url: `${USER_BASE}/me`,
    method: "GET",
  })
  return UserProfileSchema.parse(data)
}

export async function updateUserProfile(payload: UserUpdateRequest): Promise<UserProfile> {
  const data = await request<UserProfile>({
    url: `${USER_BASE}/me`,
    method: "PATCH",
    data: payload,
  })
  return UserProfileSchema.parse(data)
}
