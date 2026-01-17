import { z } from "zod"

import { request } from "@/lib/http"

const SETTINGS_BASE = "/api/v1/settings"
const ADMIN_SETTINGS_BASE = "/api/v1/admin/settings"

export const EmbeddingSettingSchema = z.object({
  model_name: z.string().nullable().optional(),
})

export type EmbeddingSetting = z.infer<typeof EmbeddingSettingSchema>

export const EmbeddingSettingUpdateSchema = z.object({
  model_name: z.string().min(1),
})

export type EmbeddingSettingUpdate = z.infer<typeof EmbeddingSettingUpdateSchema>

export async function fetchEmbeddingSetting(): Promise<EmbeddingSetting> {
  const data = await request<EmbeddingSetting>({
    url: `${SETTINGS_BASE}/embedding`,
    method: "GET",
  })
  return EmbeddingSettingSchema.parse(data)
}

export async function updateEmbeddingSetting(
  payload: EmbeddingSettingUpdate
): Promise<EmbeddingSetting> {
  const data = await request<EmbeddingSetting>({
    url: `${ADMIN_SETTINGS_BASE}/embedding`,
    method: "PATCH",
    data: payload,
  })
  return EmbeddingSettingSchema.parse(data)
}
