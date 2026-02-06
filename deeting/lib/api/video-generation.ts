import { z } from "zod"

import { request } from "@/lib/http"

const INTERNAL_VIDEO_BASE = "/api/v1/internal/videos/generations"

// ── Zod Schemas ──────────────────────────────────────────────

const VideoGenerationTaskCreateResponseSchema = z.object({
  task_id: z.string(),
  status: z.string(),
  created_at: z.string(),
  deduped: z.boolean().optional(),
})

const VideoGenerationOutputItemSchema = z.object({
  output_index: z.number(),
  asset_url: z.string().nullable().optional(),
  cover_url: z.string().nullable().optional(),
  source_url: z.string().nullable().optional(),
  seed: z.number().nullable().optional(),
  content_type: z.string().nullable().optional(),
  size_bytes: z.number().nullable().optional(),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  duration: z.number().nullable().optional(),
})

const VideoGenerationTaskListItemSchema = z.object({
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
  preview: VideoGenerationOutputItemSchema.nullable().optional(),
})

const VideoGenerationTaskDetailSchema = z.object({
  task_id: z.string(),
  status: z.string(),
  model: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  completed_at: z.string().nullable().optional(),
  error_code: z.string().nullable().optional(),
  error_message: z.string().nullable().optional(),
  outputs: z.array(VideoGenerationOutputItemSchema).optional(),
})

const VideoGenerationCancelResponseSchema = z.object({
  request_id: z.string(),
  status: z.string(),
})

const VideoGenerationTaskPageSchema = z.object({
  items: z.array(VideoGenerationTaskListItemSchema),
  next_page: z.string().nullable().optional(),
  previous_page: z.string().nullable().optional(),
})

// ── Types ────────────────────────────────────────────────────

export type VideoGenerationTaskCreateRequest = {
  model: string
  prompt: string
  negative_prompt?: string | null
  image_url?: string | null
  width?: number | null
  height?: number | null
  aspect_ratio?: string | null
  duration?: number | null
  fps?: number | null
  motion_bucket_id?: number | null
  num_outputs?: number
  steps?: number | null
  cfg_scale?: number | null
  seed?: number | null
  quality?: string | null
  style?: string | null
  extra_params?: Record<string, unknown>
  provider_model_id?: string
  session_id?: string | null
  request_id?: string | null
  encrypt_prompt?: boolean
}

export type VideoGenerationTaskCreateResponse = z.infer<
  typeof VideoGenerationTaskCreateResponseSchema
>
export type VideoGenerationOutputItem = z.infer<
  typeof VideoGenerationOutputItemSchema
>
export type VideoGenerationTaskListItem = z.infer<
  typeof VideoGenerationTaskListItemSchema
>
export type VideoGenerationTaskDetail = z.infer<
  typeof VideoGenerationTaskDetailSchema
>
export type VideoGenerationCancelResponse = z.infer<
  typeof VideoGenerationCancelResponseSchema
>
export type VideoGenerationTaskPage = z.infer<
  typeof VideoGenerationTaskPageSchema
>

export type VideoGenerationTasksQuery = {
  cursor?: string | null
  size?: number
  status?: string | null
  include_outputs?: boolean
  session_id?: string | null
}

// ── API Functions ────────────────────────────────────────────

export async function createVideoGenerationTask(
  payload: VideoGenerationTaskCreateRequest
): Promise<VideoGenerationTaskCreateResponse> {
  const data = await request({
    url: INTERNAL_VIDEO_BASE,
    method: "POST",
    data: payload,
  })
  return VideoGenerationTaskCreateResponseSchema.parse(data)
}

export async function fetchVideoGenerationTasks(
  query: VideoGenerationTasksQuery
): Promise<VideoGenerationTaskPage> {
  const data = await request({
    url: INTERNAL_VIDEO_BASE,
    method: "GET",
    params: query,
  })
  return VideoGenerationTaskPageSchema.parse(data)
}

export async function fetchVideoGenerationTask(
  taskId: string,
  includeOutputs = true
): Promise<VideoGenerationTaskDetail> {
  const data = await request({
    url: `${INTERNAL_VIDEO_BASE}/${taskId}`,
    method: "GET",
    params: { include_outputs: includeOutputs },
  })
  return VideoGenerationTaskDetailSchema.parse(data)
}

export async function cancelVideoGenerationTask(
  requestId: string
): Promise<VideoGenerationCancelResponse> {
  const data = await request({
    url: `${INTERNAL_VIDEO_BASE}/${requestId}/cancel`,
    method: "POST",
  })
  return VideoGenerationCancelResponseSchema.parse(data)
}
