import { z } from "zod"

import { request } from "@/lib/http"

const MODELS_BASE = "/api/v1/internal/models"
const AVAILABLE_MODELS_PATH = "/api/v1/models/available"

export const ModelInfoSchema = z.object({
  id: z.string(),
  object: z.string().optional(),
  owned_by: z.string().optional(),
  icon: z.string().nullable().optional(),
  upstream_model_id: z.string().nullable().optional(),
  provider_model_id: z.string().nullable().optional(),
})

export const ModelListResponseSchema = z.object({
  instances: z.array(
    z.object({
      instance_id: z.string(),
      instance_name: z.string(),
      provider: z.string().optional(),
      icon: z.string().nullable().optional(),
      models: z.array(ModelInfoSchema),
    })
  ),
})
export const AvailableModelsResponseSchema = z.object({
  items: z.array(z.string()),
})

export type ModelInfo = z.infer<typeof ModelInfoSchema>
export type ModelListResponse = z.infer<typeof ModelListResponseSchema>
export type ModelGroup = ModelListResponse["instances"][number]
export type AvailableModelsResponse = z.infer<typeof AvailableModelsResponseSchema>

export async function fetchChatModels(options?: {
  capability?: string
}): Promise<ModelListResponse> {
  const data = await request({
    url: MODELS_BASE,
    method: "GET",
    params: options?.capability ? { capability: options.capability } : undefined,
  })
  return ModelListResponseSchema.parse(data)
}

export async function fetchAvailableModels(): Promise<AvailableModelsResponse> {
  const data = await request({
    url: AVAILABLE_MODELS_PATH,
    method: "GET",
  })
  return AvailableModelsResponseSchema.parse(data)
}
