import { z } from "zod"

import { request } from "@/lib/http"

const ASSISTANTS_BASE = "/api/v1/assistants"

export const AssistantSummaryVersionSchema = z.object({
  id: z.string().uuid(),
  version: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  system_prompt: z.string().nullable().optional(),
  tags: z.array(z.string()).optional().default([]),
  published_at: z.string().nullable().optional(),
})

export const AssistantMarketItemSchema = z.object({
  assistant_id: z.string().uuid(),
  owner_user_id: z.string().uuid().nullable().optional(),
  icon_id: z.string().nullable().optional(),
  share_slug: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  published_at: z.string().nullable().optional(),
  current_version_id: z.string().uuid().nullable().optional(),
  install_count: z.number().optional().default(0),
  rating_avg: z.number().optional().default(0),
  rating_count: z.number().optional().default(0),
  tags: z.array(z.string()).default([]),
  version: AssistantSummaryVersionSchema,
  installed: z.boolean().optional().default(false),
})

export const AssistantSummarySchema = z.object({
  assistant_id: z.string().uuid(),
  owner_user_id: z.string().uuid().nullable().optional(),
  icon_id: z.string().nullable().optional(),
  share_slug: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  published_at: z.string().nullable().optional(),
  current_version_id: z.string().uuid().nullable().optional(),
  install_count: z.number().optional().default(0),
  rating_avg: z.number().optional().default(0),
  rating_count: z.number().optional().default(0),
  tags: z.array(z.string()).default([]),
  version: AssistantSummaryVersionSchema,
})

export const CursorPageSchema = z.object({
  items: z.array(AssistantMarketItemSchema),
  next_page: z.string().nullable().optional(),
  previous_page: z.string().nullable().optional(),
})

export const AssistantInstallItemSchema = z.object({
  id: z.string().uuid(),
  assistant_id: z.string().uuid(),
  alias: z.string().nullable().optional(),
  icon_override: z.string().nullable().optional(),
  pinned_version_id: z.string().uuid().nullable().optional(),
  follow_latest: z.boolean().optional(),
  is_enabled: z.boolean().optional(),
  sort_order: z.number().optional(),
  assistant: AssistantSummarySchema,
})

export const AssistantInstallPageSchema = z.object({
  items: z.array(AssistantInstallItemSchema),
  next_page: z.string().nullable().optional(),
  previous_page: z.string().nullable().optional(),
})

export type AssistantMarketItem = z.infer<typeof AssistantMarketItemSchema>
export type AssistantInstallItem = z.infer<typeof AssistantInstallItemSchema>
export type AssistantInstallPage = z.infer<typeof AssistantInstallPageSchema>

export const AssistantVersionSchema = z.object({
  id: z.string().uuid(),
  version: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  system_prompt: z.string().optional(),
  tags: z.array(z.string()).optional().default([]),
})

export const AssistantDTOSchema = z.object({
  id: z.string().uuid(),
  owner_user_id: z.string().uuid().nullable().optional(),
  visibility: z.string(),
  status: z.string(),
  share_slug: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  icon_id: z.string().nullable().optional(),
  current_version_id: z.string().uuid().nullable().optional(),
  published_at: z.string().nullable().optional(),
  versions: z.array(AssistantVersionSchema).default([]),
  install_count: z.number().optional().default(0),
  rating_avg: z.number().optional().default(0),
  rating_count: z.number().optional().default(0),
})

export const AssistantListResponseSchema = z.object({
  items: z.array(AssistantDTOSchema),
  next_cursor: z.string().nullable().optional(),
  size: z.number().optional(),
})

export type AssistantDTO = z.infer<typeof AssistantDTOSchema>

export const AssistantTagSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
})

export type AssistantTag = z.infer<typeof AssistantTagSchema>

export type AssistantMarketQuery = {
  cursor?: string | null
  size?: number
  q?: string
  tags?: string[]
}

export async function fetchAssistantMarket(query: AssistantMarketQuery) {
  const data = await request({
    url: `${ASSISTANTS_BASE}/market`,
    method: "GET",
    params: query,
  })
  return CursorPageSchema.parse(data)
}

export async function fetchAssistantInstalls(params: { cursor?: string | null; size?: number }) {
  const data = await request({
    url: `${ASSISTANTS_BASE}/installs`,
    method: "GET",
    params,
  })
  return AssistantInstallPageSchema.parse(data)
}

export async function fetchAssistantTags() {
  const data = await request({
    url: `${ASSISTANTS_BASE}/tags`,
    method: "GET",
  })
  return z.array(AssistantTagSchema).parse(data)
}

export async function fetchOwnedAssistants(params: { cursor?: string | null; size?: number }) {
  const data = await request({
    url: `${ASSISTANTS_BASE}/owned`,
    method: "GET",
    params,
  })
  return AssistantListResponseSchema.parse(data)
}

export async function installAssistant(assistantId: string) {
  return request({
    url: `${ASSISTANTS_BASE}/${assistantId}/install`,
    method: "POST",
  })
}

export async function uninstallAssistant(assistantId: string) {
  return request({
    url: `${ASSISTANTS_BASE}/${assistantId}/install`,
    method: "DELETE",
  })
}

export async function rateAssistant(assistantId: string, rating: number) {
  return request({
    url: `${ASSISTANTS_BASE}/${assistantId}/rating`,
    method: "POST",
    data: { rating },
  })
}

export async function previewAssistant(
  assistantId: string,
  payload: {
    message: string
    stream?: boolean
    temperature?: number | null
    max_tokens?: number | null
  }
) {
  return request({
    url: `${ASSISTANTS_BASE}/${assistantId}/preview`,
    method: "POST",
    data: payload,
  })
}

export async function createAssistant(payload: {
  visibility: string
  status: string
  summary?: string | null
  icon_id?: string | null
  version: {
    name: string
    description?: string | null
    system_prompt: string
    tags?: string[]
  }
}) {
  const data = await request({
    url: `${ASSISTANTS_BASE}`,
    method: "POST",
    data: payload,
  })
  return AssistantDTOSchema.parse(data)
}
