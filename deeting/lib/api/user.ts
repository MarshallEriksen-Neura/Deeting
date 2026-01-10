import { z } from "zod"

import { request } from "@/lib/http"

const USER_BASE = "/api/v1/users"

export const PermissionFlagsSchema = z.record(z.number().int())

export const UserProfileSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  username: z.string().nullable(),
  is_active: z.boolean(),
  is_superuser: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
  permission_flags: PermissionFlagsSchema,
})

export type UserProfile = z.infer<typeof UserProfileSchema>

export async function fetchCurrentUser(): Promise<UserProfile> {
  const data = await request<UserProfile>({
    url: `${USER_BASE}/me`,
    method: "GET",
  })
  return UserProfileSchema.parse(data)
}
