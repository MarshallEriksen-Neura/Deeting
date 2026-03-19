import { z } from "zod"

import { request } from "@/lib/http"
import { isTauriRuntime } from "@/lib/runtime/tauri"

const ASSISTANTS_BASE = "/api/v1/assistants"
const UUID_LIKE_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<T>(command, args)
}

const UuidLikeSchema = z.string().regex(UUID_LIKE_PATTERN, "Invalid assistant id format")

function summarizeSchemaError(error: z.ZodError) {
  const firstIssue = error.issues[0]
  if (!firstIssue) return "response shape mismatch"
  const path = firstIssue.path.length > 0 ? firstIssue.path.join(".") : "root"
  return `${path}: ${firstIssue.message}`
}

function parseWithFriendlyError<T>(
  schema: z.ZodType<T>,
  data: unknown,
  label: string
): T {
  const parsed = schema.safeParse(data)
  if (parsed.success) {
    return parsed.data
  }

  throw new Error(`${label}: ${summarizeSchemaError(parsed.error)}`)
}

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

export const AssistantRatingResponseSchema = z.object({
  assistant_id: z.string().uuid(),
  rating_avg: z.number(),
  rating_count: z.number().int(),
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
  id: UuidLikeSchema,
  name: z.string(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
})

export type AssistantTag = z.infer<typeof AssistantTagSchema>

export const LocalAssistantSchema = z.object({
  id: UuidLikeSchema,
  name: z.string(),
  description: z.string().nullable().optional(),
  avatar: z.string().nullable().optional(),
  system_prompt: z.string(),
  model_config: z.unknown().nullable().optional(),
  tags: z.array(z.string()).default([]),
  visibility: z.string(),
  source: z.string(),
  cloud_id: z.string().nullable().optional(),
  is_deleted: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
})

export const LocalAssistantEntitySchema = z.object({
  id: UuidLikeSchema,
  owner_user_id: UuidLikeSchema.nullable().optional(),
  visibility: z.string(),
  status: z.string(),
  share_slug: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  icon_id: z.string().nullable().optional(),
  install_count: z.number().default(0),
  rating_avg: z.number().default(0),
  rating_count: z.number().default(0),
  current_version_id: UuidLikeSchema.nullable().optional(),
  published_at: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
})

export const LocalAssistantVersionSchema = z.object({
  id: UuidLikeSchema,
  assistant_id: UuidLikeSchema,
  version: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  system_prompt: z.string(),
  model_config: z.unknown().nullable().optional(),
  tags: z.array(z.string()).default([]),
  changelog: z.string().nullable().optional(),
  published_at: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
})

export type LocalAssistant = z.infer<typeof LocalAssistantSchema>
export type LocalAssistantEntity = z.infer<typeof LocalAssistantEntitySchema>
export type LocalAssistantVersion = z.infer<typeof LocalAssistantVersionSchema>

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

export async function listLocalAssistants() {
  if (!isTauriRuntime()) {
    throw new Error("listLocalAssistants is only supported in Tauri runtime")
  }

  const data = await invokeTauri<unknown>("list_local_assistants")
  return parseWithFriendlyError(
    z.array(LocalAssistantSchema),
    data,
    "local assistants response mismatch"
  )
}

export async function listLocalAssistantEntities() {
  if (!isTauriRuntime()) {
    throw new Error("listLocalAssistantEntities is only supported in Tauri runtime")
  }

  const data = await invokeTauri<unknown>("list_local_assistant_entities")
  return parseWithFriendlyError(
    z.array(LocalAssistantEntitySchema),
    data,
    "local assistant entities response mismatch"
  )
}

export async function listLocalAssistantVersions(assistantId?: string) {
  if (!isTauriRuntime()) {
    throw new Error("listLocalAssistantVersions is only supported in Tauri runtime")
  }

  const data = assistantId
    ? await invokeTauri<unknown>("list_local_assistant_versions", {
        assistant_id: assistantId,
      })
    : await invokeTauri<unknown>("list_local_assistant_versions")
  return parseWithFriendlyError(
    z.array(LocalAssistantVersionSchema),
    data,
    "local assistant versions response mismatch"
  )
}

export async function listLocalAssistantTags() {
  if (!isTauriRuntime()) {
    throw new Error("listLocalAssistantTags is only supported in Tauri runtime")
  }

  const data = await invokeTauri<unknown>("list_local_assistant_tags")
  return parseWithFriendlyError(
    z.array(AssistantTagSchema),
    data,
    "local assistant tags response mismatch"
  )
}

export async function listLocalAssistantInstallations(params?: {
  cursor?: string | null
  size?: number
}) {
  if (!isTauriRuntime()) {
    throw new Error("listLocalAssistantInstallations is only supported in Tauri runtime")
  }

  const data = await invokeTauri<unknown>("list_local_assistant_installations", {
    query: {
      cursor: params?.cursor ?? null,
      size: params?.size ?? 50,
    },
  })
  return AssistantInstallPageSchema.parse(data)
}

export async function createLocalAssistant(payload: {
  name: string
  description?: string | null
  avatar?: string | null
  system_prompt: string
  model_config?: Record<string, unknown> | null
  tags?: string[]
  visibility?: string
  source?: string
  cloud_id?: string | null
}) {
  if (!isTauriRuntime()) {
    throw new Error("createLocalAssistant is only supported in Tauri runtime")
  }

  const data = await invokeTauri<unknown>("create_local_assistant", {
    payload,
  })
  return z.string().uuid().parse(data)
}

export async function updateLocalAssistant(
  assistantId: string,
  payload: {
    name?: string
    description?: string | null
    avatar?: string | null
    system_prompt?: string
    model_config?: Record<string, unknown> | null
    tags?: string[]
    visibility?: string
    source?: string
    cloud_id?: string | null
  }
) {
  if (!isTauriRuntime()) {
    throw new Error("updateLocalAssistant is only supported in Tauri runtime")
  }

  const data = await invokeTauri<unknown>("update_local_assistant", {
    id: assistantId,
    payload,
  })
  return LocalAssistantSchema.parse(data)
}

export async function deleteLocalAssistant(assistantId: string) {
  if (!isTauriRuntime()) {
    throw new Error("deleteLocalAssistant is only supported in Tauri runtime")
  }

  await invokeTauri("delete_local_assistant", { id: assistantId })
}

export async function installLocalAssistant(
  assistantId: string,
  payload?: {
    follow_latest?: boolean
    pinned_version_id?: string | null
  }
) {
  if (!isTauriRuntime()) {
    throw new Error("installLocalAssistant is only supported in Tauri runtime")
  }

  const data = await invokeTauri<unknown>("install_local_assistant", {
    assistant_id: assistantId,
    payload: {
      follow_latest: payload?.follow_latest ?? true,
      pinned_version_id: payload?.pinned_version_id ?? null,
    },
  })
  return AssistantInstallItemSchema.parse(data)
}

export async function updateLocalAssistantInstallation(
  assistantId: string,
  payload: {
    alias?: string | null
    icon_override?: string | null
    pinned_version_id?: string | null
    follow_latest?: boolean | null
    is_enabled?: boolean | null
    sort_order?: number | null
  }
) {
  if (!isTauriRuntime()) {
    throw new Error("updateLocalAssistantInstallation is only supported in Tauri runtime")
  }

  const data = await invokeTauri<unknown>("update_local_assistant_installation", {
    assistant_id: assistantId,
    payload,
  })
  return AssistantInstallItemSchema.parse(data)
}

export async function uninstallLocalAssistant(assistantId: string) {
  if (!isTauriRuntime()) {
    throw new Error("uninstallLocalAssistant is only supported in Tauri runtime")
  }

  await invokeTauri("delete_local_assistant_installation", {
    assistant_id: assistantId,
  })
}

export async function installAssistant(
  assistantId: string,
  payload?: {
    follow_latest?: boolean
    pinned_version_id?: string | null
  }
) {
  return request({
    url: `${ASSISTANTS_BASE}/${assistantId}/install`,
    method: "POST",
    data: payload,
  })
}

export async function uninstallAssistant(assistantId: string) {
  return request({
    url: `${ASSISTANTS_BASE}/${assistantId}/install`,
    method: "DELETE",
  })
}

export async function updateAssistantInstall(
  assistantId: string,
  payload: {
    alias?: string | null
    icon_override?: string | null
    pinned_version_id?: string | null
    follow_latest?: boolean | null
    is_enabled?: boolean | null
    sort_order?: number | null
  }
) {
  return request({
    url: `${ASSISTANTS_BASE}/${assistantId}/install`,
    method: "PATCH",
    data: payload,
  })
}

export async function rateAssistant(assistantId: string, rating: number) {
  if (isTauriRuntime()) {
    const data = await invokeTauri<{
      assistant_id: string
      rating_avg: number
      rating_count: number
    }>("rate_local_assistant", {
      assistant_id: assistantId,
      payload: { rating },
    })
    return AssistantRatingResponseSchema.parse(data)
  }

  const data = await request({
    url: `${ASSISTANTS_BASE}/${assistantId}/rating`,
    method: "POST",
    data: { rating },
  })
  return AssistantRatingResponseSchema.parse(data)
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
  if (isTauriRuntime()) {
    const data = await invokeTauri<{ content: string }>("preview_local_assistant", {
      assistant_id: assistantId,
      payload: {
        message: payload.message,
        stream: payload.stream ?? false,
        temperature: payload.temperature ?? null,
        max_tokens: payload.max_tokens ?? null,
      },
    })
    return {
      object: "chat.completion",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: data.content,
          },
          finish_reason: "stop",
        },
      ],
    }
  }

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
    model_config?: Record<string, unknown> | null
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

export async function updateAssistant(
  assistantId: string,
  payload: {
    visibility?: string
    status?: string
    summary?: string | null
    icon_id?: string | null
    current_version_id?: string | null
    version?: {
      version?: string
      name: string
      description?: string | null
      system_prompt: string
      model_config?: Record<string, unknown> | null
      tags?: string[]
      changelog?: string | null
    }
  }
) {
  const data = await request({
    url: `${ASSISTANTS_BASE}/${assistantId}`,
    method: "PATCH",
    data: payload,
  })
  return AssistantDTOSchema.parse(data)
}

export async function deleteAssistant(assistantId: string) {
  return request({
    url: `${ASSISTANTS_BASE}/${assistantId}`,
    method: "DELETE",
  })
}
