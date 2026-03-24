import { z } from "zod"

import { isTauriRuntime } from "@/lib/api/desktop-config"
import { request } from "@/lib/http"
import { openApiSSE } from "@/lib/http"

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<T>(command, args)
}

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
  negative_prompt: z.string().nullable().optional(),
  aspect_ratio: z.string().nullable().optional(),
  steps: z.number().nullable().optional(),
  cfg_scale: z.number().nullable().optional(),
  seed: z.number().nullable().optional(),
  provider_model_id: z.string().nullable().optional(),
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
  if (isTauriRuntime()) {
    const data = await invokeTauri<unknown>("create_local_image_generation_task", {
      payload,
    })
    return ImageGenerationTaskCreateResponseSchema.parse(data)
  }
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
  if (isTauriRuntime()) {
    const data = await invokeTauri<unknown>("get_local_image_generation_task", {
      taskId,
    })
    return ImageGenerationTaskDetailSchema.parse(data)
  }
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
  if (isTauriRuntime()) {
    const data = await invokeTauri<unknown>("list_local_image_generation_tasks", {
      query,
    })
    return ImageGenerationTaskPageSchema.parse(data)
  }
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
  if (isTauriRuntime()) {
    const data = await invokeTauri<unknown>("cancel_local_image_generation_task", {
      request_id: requestId,
    })
    return ImageGenerationCancelResponseSchema.parse(data)
  }
  const data = await request({
    url: `${INTERNAL_IMAGE_BASE}/${requestId}/cancel`,
    method: "POST",
  })
  return ImageGenerationCancelResponseSchema.parse(data)
}

export function watchImageGenerationTask(
  taskId: string,
  handlers: {
    onMessage: (event: { data: unknown }) => void
    onError?: () => void
  }
): () => void {
  if (!isTauriRuntime()) {
    return openApiSSE(`/api/v1/internal/images/generations/${taskId}/events`, handlers)
  }

  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const run = async () => {
    if (stopped) return
    try {
      const detail = await fetchImageGenerationTask(taskId, true)
      handlers.onMessage({
        data: {
          type: "status",
          task_id: detail.task_id,
          status: detail.status,
          updated_at: detail.updated_at,
          error_code: detail.error_code ?? null,
          error_message: detail.error_message ?? null,
          outputs: detail.outputs ?? [],
        },
      })

      if (["succeeded", "failed", "canceled"].includes(detail.status)) {
        handlers.onMessage({ data: "[DONE]" })
        return
      }

      timer = setTimeout(run, 1000)
    } catch {
      handlers.onError?.()
    }
  }

  void run()

  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
  }
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
