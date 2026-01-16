import { z } from "zod"

import { request } from "@/lib/http"

const MODELS_BASE = "/api/v1/internal/models"

export const ModelInfoSchema = z.object({
  id: z.string(),
  object: z.string().optional(),
  owned_by: z.string().optional(),
  icon: z.string().nullable().optional(),
  upstream_model_id: z.string().nullable().optional(),
  provider_model_id: z.string().nullable().optional(),
})

export const ModelListResponseSchema = z.object({
  data: z.array(ModelInfoSchema),
})

export type ModelInfo = z.infer<typeof ModelInfoSchema>
export type ModelListResponse = z.infer<typeof ModelListResponseSchema>

export async function fetchChatModels(): Promise<ModelListResponse> {
  const data = await request({
    url: MODELS_BASE,
    method: "GET",
  })
  return ModelListResponseSchema.parse(data)
}
