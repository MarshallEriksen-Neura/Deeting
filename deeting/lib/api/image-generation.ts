import { z } from "zod"

import { request } from "@/lib/http"

const INTERNAL_IMAGE_BASE = "/api/v1/internal/images/generations"

const ImageGenerationTaskCreateResponseSchema = z.object({
  task_id: z.string(),
  status: z.string(),
  created_at: z.string(),
  deduped: z.boolean().optional(),
})

const ImageGenerationCancelResponseSchema = z.object({
  request_id: z.string(),
  status: z.string(),
})

const ImageGenerationOutputItemSchema = z.object({
  output_index: z.number(),
  asset_url: z.string().nullable().optional(),
  source_url: z.string().nullable().optional(),
  seed: z.number().nullable().optional(),
  content_type: z.string().nullable().optional(),
  size_bytes: z.number().nullable().optional(),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
})

const ImageGenerationTaskDetailSchema = z.object({
  task_id: z.string(),
  status: z.string(),
  model: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  completed_at: z.string().nullable().optional(),
  error_code: z.string().nullable().optional(),
  error_message: z.string().nullable().optional(),
  outputs: z.array(ImageGenerationOutputItemSchema).optional(),
})

const ImageGenerationTaskItemSchema = z.object({
  task_id: z.string(),
  status: z.string(),
  model: z.string(),
  session_id: z.string().nullable().optional(),
  prompt: z.string().nullable().optional(),
  prompt_encrypted: z.boolean().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  completed_at: z.string().nullable().optional(),
  error_code: z.string().nullable().optional(),
  error_message: z.string().nullable().optional(),
  preview: ImageGenerationOutputItemSchema.nullable().optional(),
})

const ImageGenerationTaskPageSchema = z.object({
  items: z.array(ImageGenerationTaskItemSchema),
  next_page: z.string().nullable().optional(),
  previous_page: z.string().nullable().optional(),
})

export type ImageGenerationTaskCreateRequest = {
  model: string
  prompt: string
  negative_prompt?: string | null
  width?: number | null
  height?: number | null
  aspect_ratio?: string | null
  num_outputs?: number
  steps?: number | null
  cfg_scale?: number | null
  seed?: number | null
  sampler_name?: string | null
  quality?: string | null
  style?: string | null
  response_format?: string | null
  extra_params?: Record<string, unknown>
  provider_model_id: string
  session_id?: string | null
  request_id?: string | null
  encrypt_prompt?: boolean
  image_url?: string | null
}

export type ImageGenerationTasksQuery = {
  cursor?: string | null
  size?: number
  status?: string | null
  include_outputs?: boolean
  session_id?: string | null
}

export type ImageGenerationTaskCreateResponse = z.infer<
  typeof ImageGenerationTaskCreateResponseSchema
>
export type ImageGenerationCancelResponse = z.infer<
  typeof ImageGenerationCancelResponseSchema
>
export type ImageGenerationOutputItem = z.infer<
  typeof ImageGenerationOutputItemSchema
>
export type ImageGenerationTaskDetail = z.infer<
  typeof ImageGenerationTaskDetailSchema
>
export type ImageGenerationTaskItem = z.infer<typeof ImageGenerationTaskItemSchema>
export type ImageGenerationTaskPage = z.infer<typeof ImageGenerationTaskPageSchema>

export async function createImageGenerationTask(
  payload: ImageGenerationTaskCreateRequest
): Promise<ImageGenerationTaskCreateResponse> {
  const data = await request({
    url: INTERNAL_IMAGE_BASE,
    method: "POST",
    data: payload,
  })
  return ImageGenerationTaskCreateResponseSchema.parse(data)
}

export async function fetchImageGenerationTask(
  taskId: string,
  includeOutputs = true
): Promise<ImageGenerationTaskDetail> {
  const data = await request({
    url: `${INTERNAL_IMAGE_BASE}/${taskId}`,
    method: "GET",
    params: { include_outputs: includeOutputs },
  })
  return ImageGenerationTaskDetailSchema.parse(data)
}

export async function fetchImageGenerationTasks(
  query: ImageGenerationTasksQuery
): Promise<ImageGenerationTaskPage> {
  const data = await request({
    url: INTERNAL_IMAGE_BASE,
    method: "GET",
    params: query,
  })
  return ImageGenerationTaskPageSchema.parse(data)
}

export async function cancelImageGenerationTask(
  requestId: string
): Promise<ImageGenerationCancelResponse> {
  const data = await request({
    url: `${INTERNAL_IMAGE_BASE}/${requestId}/cancel`,
    method: "POST",
  })
  return ImageGenerationCancelResponseSchema.parse(data)
}
