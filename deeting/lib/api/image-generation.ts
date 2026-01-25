import { z } from "zod"

import { request } from "@/lib/http"

const INTERNAL_IMAGE_BASE = "/api/v1/internal/images/generations"
const PUBLIC_IMAGE_SHARE_BASE = "/api/v1/public/images/shares"

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

const ImageShareStateSchema = z.object({
  share_id: z.string(),
  task_id: z.string(),
  is_active: z.boolean(),
  shared_at: z.string().nullable().optional(),
  revoked_at: z.string().nullable().optional(),
  prompt_encrypted: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
})

const ImageShareItemSchema = z.object({
  share_id: z.string(),
  task_id: z.string(),
  model: z.string(),
  prompt: z.string().nullable().optional(),
  prompt_encrypted: z.boolean().optional(),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  num_outputs: z.number(),
  steps: z.number().nullable().optional(),
  cfg_scale: z.number().nullable().optional(),
  seed: z.number().nullable().optional(),
  shared_at: z.string(),
  tags: z.array(z.string()).optional(),
  preview: ImageGenerationOutputItemSchema.nullable().optional(),
})

const ImageSharePageSchema = z.object({
  items: z.array(ImageShareItemSchema),
  next_page: z.string().nullable().optional(),
  previous_page: z.string().nullable().optional(),
})

const ImageShareDetailSchema = z.object({
  share_id: z.string(),
  task_id: z.string(),
  model: z.string(),
  prompt: z.string().nullable().optional(),
  prompt_encrypted: z.boolean().optional(),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  num_outputs: z.number(),
  steps: z.number().nullable().optional(),
  cfg_scale: z.number().nullable().optional(),
  seed: z.number().nullable().optional(),
  shared_at: z.string(),
  tags: z.array(z.string()).optional(),
  outputs: z.array(ImageGenerationOutputItemSchema).optional(),
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

export type ImageShareRequest = {
  tags?: string[] | null
}

export type PublicImageShareQuery = {
  cursor?: string | null
  size?: number
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
export type ImageShareState = z.infer<typeof ImageShareStateSchema>
export type ImageShareItem = z.infer<typeof ImageShareItemSchema>
export type ImageSharePage = z.infer<typeof ImageSharePageSchema>
export type ImageShareDetail = z.infer<typeof ImageShareDetailSchema>

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

export async function shareImageGenerationTask(
  taskId: string,
  payload: ImageShareRequest = {}
): Promise<ImageShareState> {
  const data = await request({
    url: `${INTERNAL_IMAGE_BASE}/${taskId}/share`,
    method: "POST",
    data: payload,
  })
  return ImageShareStateSchema.parse(data)
}

export async function unshareImageGenerationTask(
  taskId: string
): Promise<ImageShareState> {
  const data = await request({
    url: `${INTERNAL_IMAGE_BASE}/${taskId}/share`,
    method: "DELETE",
  })
  return ImageShareStateSchema.parse(data)
}

export async function fetchPublicImageShares(
  query: PublicImageShareQuery
): Promise<ImageSharePage> {
  const data = await request({
    url: PUBLIC_IMAGE_SHARE_BASE,
    method: "GET",
    params: query,
  })
  return ImageSharePageSchema.parse(data)
}

export async function fetchPublicImageShareDetail(
  shareId: string
): Promise<ImageShareDetail> {
  const data = await request({
    url: `${PUBLIC_IMAGE_SHARE_BASE}/${shareId}`,
    method: "GET",
  })
  return ImageShareDetailSchema.parse(data)
}
