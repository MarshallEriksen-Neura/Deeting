import { z } from "zod"

import { request } from "@/lib/http"
const PUBLIC_IMAGE_SHARE_BASE = "/api/v1/public/images/shares"

const ImageOutputItemSchema = z.object({
  output_index: z.number(),
  asset_url: z.string().nullable().optional(),
  source_url: z.string().nullable().optional(),
  seed: z.number().nullable().optional(),
  content_type: z.string().nullable().optional(),
  size_bytes: z.number().nullable().optional(),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
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
  preview: ImageOutputItemSchema.nullable().optional(),
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
  outputs: z.array(ImageOutputItemSchema).optional(),
})

export type ImageShareRequest = {
  tags?: string[] | null
}

export type PublicImageShareQuery = {
  cursor?: string | null
  size?: number
}
export type ImageOutputItem = z.infer<typeof ImageOutputItemSchema>
export type ImageShareState = z.infer<typeof ImageShareStateSchema>
export type ImageShareItem = z.infer<typeof ImageShareItemSchema>
export type ImageSharePage = z.infer<typeof ImageSharePageSchema>
export type ImageShareDetail = z.infer<typeof ImageShareDetailSchema>

export async function shareImageGenerationTask(
  taskId: string,
  payload: ImageShareRequest = {}
): Promise<ImageShareState> {
  const data = await request({
    url: `/api/v1/internal/images/generations/${taskId}/share`,
    method: "POST",
    data: payload,
  })
  return ImageShareStateSchema.parse(data)
}

export async function unshareImageGenerationTask(
  taskId: string
): Promise<ImageShareState> {
  const data = await request({
    url: `/api/v1/internal/images/generations/${taskId}/share`,
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
