import { z } from "zod"

import { request } from "@/lib/http"

import { trySyncLocalSystemAssetsFromCloud } from "./desktop-system-assets"

const ASSISTANTS_BASE = "/api/v1/assistants"
const assistantMessageResponseSchema = z.object({
  message: z.string(),
})

const isTauriRuntime = () =>
  process.env.NEXT_PUBLIC_IS_TAURI === "true" &&
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)

const cloudOnlyOperationError = (operation: string) =>
  new Error(`${operation} is cloud-only and not supported in desktop local mode`)

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<T>(command, args)
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

type LocalAssistantEntityPayload = {
  id: string
  owner_user_id?: string | null
  visibility: string
  status: string
  share_slug?: string | null
  summary?: string | null
  icon_id?: string | null
  current_version_id?: string | null
  published_at?: string | null
  install_count?: number
  rating_avg?: number
  rating_count?: number
  updated_at?: string
}

type LocalAssistantVersionPayload = {
  id: string
  assistant_id: string
  version: string
  name: string
  description?: string | null
  system_prompt: string
  tags?: string[]
  published_at?: string | null
  created_at?: string
  updated_at?: string
}

const toAssistantVersionDTO = (version: LocalAssistantVersionPayload) => ({
  id: version.id,
  version: version.version,
  name: version.name,
  description: version.description ?? null,
  system_prompt: version.system_prompt,
  tags: version.tags ?? [],
})

const toAssistantDTO = (
  entity: LocalAssistantEntityPayload,
  versions: LocalAssistantVersionPayload[]
) => {
  const mappedVersions = versions.map(toAssistantVersionDTO)
  const currentVersionId = entity.current_version_id ?? mappedVersions[0]?.id ?? null
  return {
    id: entity.id,
    owner_user_id: entity.owner_user_id ?? null,
    visibility: entity.visibility,
    status: entity.status,
    share_slug: entity.share_slug ?? null,
    summary: entity.summary ?? null,
    icon_id: entity.icon_id ?? null,
    current_version_id: currentVersionId,
    published_at: entity.published_at ?? null,
    versions: mappedVersions,
    install_count: entity.install_count ?? 0,
    rating_avg: entity.rating_avg ?? 0,
    rating_count: entity.rating_count ?? 0,
  }
}

async function getLocalAssistantDTOById(assistantId: string): Promise<AssistantDTO> {
  const [entities, versions] = await Promise.all([
    invokeTauri<LocalAssistantEntityPayload[]>("list_local_assistant_entities"),
    invokeTauri<LocalAssistantVersionPayload[]>("list_local_assistant_versions", {
      assistant_id: assistantId,
    }),
  ])
  const entity = (entities ?? []).find((item) => item.id === assistantId)
  if (!entity) {
    throw new Error("local assistant not found")
  }
  return AssistantDTOSchema.parse(toAssistantDTO(entity, versions ?? []))
}

const normalizeTagForMatch = (tag: string) => tag.replace(/^#/, "").trim().toLowerCase()

const includeBySearch = (item: AssistantMarketItem, queryText: string) => {
  const text = queryText.toLowerCase()
  const fields = [
    item.version.name,
    item.version.description ?? "",
    item.summary ?? "",
    ...item.tags,
    ...item.version.tags,
  ]
  return fields.some((field) => field.toLowerCase().includes(text))
}

async function listAllInstalledAssistantIds(): Promise<Set<string>> {
  const installedIds = new Set<string>()
  let cursor: string | null = null
  let guard = 0
  do {
    const pageRaw = await invokeTauri<AssistantInstallPage>("list_local_assistant_installs", {
      query: { cursor, size: 200 },
    })
    const page = AssistantInstallPageSchema.parse(pageRaw)
    for (const item of page.items) {
      installedIds.add(item.assistant_id)
    }
    cursor = page.next_page ?? null
    guard += 1
  } while (cursor && guard < 20)
  return installedIds
}

export async function fetchAssistantMarket(query: AssistantMarketQuery) {
  if (isTauriRuntime()) {
    await trySyncLocalSystemAssetsFromCloud()

    const [entities, versions, installedIds] = await Promise.all([
      invokeTauri<LocalAssistantEntityPayload[]>("list_local_assistant_entities"),
      invokeTauri<LocalAssistantVersionPayload[]>("list_local_assistant_versions"),
      listAllInstalledAssistantIds(),
    ])

    const versionsByAssistant = new Map<string, LocalAssistantVersionPayload[]>()
    for (const version of versions ?? []) {
      const list = versionsByAssistant.get(version.assistant_id) ?? []
      list.push(version)
      versionsByAssistant.set(version.assistant_id, list)
    }

    const items: AssistantMarketItem[] = []
    for (const entity of entities ?? []) {
      const assistantVersions = versionsByAssistant.get(entity.id) ?? []
      const current =
        assistantVersions.find((v) => v.id === entity.current_version_id) ?? assistantVersions[0]
      if (!current) {
        continue
      }

      items.push({
        assistant_id: entity.id,
        owner_user_id: entity.owner_user_id ?? null,
        icon_id: entity.icon_id ?? null,
        share_slug: entity.share_slug ?? null,
        summary: entity.summary ?? null,
        published_at: entity.published_at ?? null,
        current_version_id: entity.current_version_id ?? current.id,
        install_count: entity.install_count ?? 0,
        rating_avg: entity.rating_avg ?? 0,
        rating_count: entity.rating_count ?? 0,
        tags: current.tags ?? [],
        version: {
          id: current.id,
          version: current.version,
          name: current.name,
          description: current.description ?? null,
          system_prompt: current.system_prompt,
          tags: current.tags ?? [],
          published_at: current.published_at ?? null,
        },
        installed: installedIds.has(entity.id),
      })
    }

    const filteredByQ = query.q?.trim()
      ? items.filter((item) => includeBySearch(item, query.q!.trim()))
      : items

    const tagFilters = (query.tags ?? []).map(normalizeTagForMatch).filter(Boolean)
    const filtered =
      tagFilters.length > 0
        ? filteredByQ.filter((item) => {
            const allTags = new Set(
              [...item.tags, ...item.version.tags].map(normalizeTagForMatch).filter(Boolean)
            )
            return tagFilters.some((tag) => allTags.has(tag))
          })
        : filteredByQ

    filtered.sort((a, b) => {
      const dateA = Date.parse(a.published_at ?? "") || 0
      const dateB = Date.parse(b.published_at ?? "") || 0
      if (dateA !== dateB) {
        return dateB - dateA
      }
      return (b.install_count ?? 0) - (a.install_count ?? 0)
    })

    const size = Math.max(1, query.size ?? 8)
    const offset = Math.max(0, Number.parseInt(query.cursor ?? "0", 10) || 0)
    const pageItems = filtered.slice(offset, offset + size)
    const nextPage = offset + size < filtered.length ? String(offset + size) : null
    const previousPage = offset > 0 ? String(Math.max(0, offset - size)) : null

    return CursorPageSchema.parse({
      items: pageItems,
      next_page: nextPage,
      previous_page: previousPage,
    })
  }

  const data = await request({
    url: `${ASSISTANTS_BASE}/market`,
    method: "GET",
    params: query,
  })
  return CursorPageSchema.parse(data)
}

export async function fetchAssistantInstalls(params: { cursor?: string | null; size?: number }) {
  if (isTauriRuntime()) {
    const data = await invokeTauri<AssistantInstallPage>("list_local_assistant_installs", {
      query: {
        cursor: params.cursor ?? null,
        size: params.size ?? null,
      },
    })
    return AssistantInstallPageSchema.parse(data)
  }

  const data = await request({
    url: `${ASSISTANTS_BASE}/installs`,
    method: "GET",
    params,
  })
  return AssistantInstallPageSchema.parse(data)
}

export async function fetchAssistantTags() {
  if (isTauriRuntime()) {
    const data = await invokeTauri<AssistantTag[]>("list_local_assistant_tags")
    return z.array(AssistantTagSchema).parse(data)
  }

  const data = await request({
    url: `${ASSISTANTS_BASE}/tags`,
    method: "GET",
  })
  return z.array(AssistantTagSchema).parse(data)
}

export async function fetchOwnedAssistants(params: { cursor?: string | null; size?: number }) {
  if (isTauriRuntime()) {
    const [entities, versions] = await Promise.all([
      invokeTauri<LocalAssistantEntityPayload[]>("list_local_assistant_entities"),
      invokeTauri<LocalAssistantVersionPayload[]>("list_local_assistant_versions"),
    ])

    const versionMap = new Map<string, LocalAssistantVersionPayload[]>()

    for (const version of versions ?? []) {
      const list = versionMap.get(version.assistant_id) ?? []
      list.push(version)
      versionMap.set(version.assistant_id, list)
    }

    const size = params.size ?? entities.length
    const offset = Number.parseInt((params.cursor ?? "0").toString(), 10) || 0
    const safeOffset = Math.max(0, offset)
    const pageItems = (entities ?? [])
      .slice(safeOffset, safeOffset + size)
      .map((entity) => toAssistantDTO(entity, versionMap.get(entity.id) ?? []))

    const nextCursor =
      safeOffset + size < (entities?.length ?? 0) ? String(safeOffset + size) : null
    return AssistantListResponseSchema.parse({
      items: pageItems,
      next_cursor: nextCursor,
      size: pageItems.length,
    })
  }

  const data = await request({
    url: `${ASSISTANTS_BASE}/owned`,
    method: "GET",
    params,
  })
  return AssistantListResponseSchema.parse(data)
}

export async function installAssistant(
  assistantId: string,
  payload?: {
    follow_latest?: boolean
    pinned_version_id?: string | null
  }
) {
  if (isTauriRuntime()) {
    const data = await invokeTauri<AssistantInstallItem>("install_local_assistant", {
      assistant_id: assistantId,
      payload: payload
        ? {
            follow_latest: payload.follow_latest ?? null,
            pinned_version_id: payload.pinned_version_id ?? null,
          }
        : null,
    })
    return AssistantInstallItemSchema.parse(data)
  }

  return request({
    url: `${ASSISTANTS_BASE}/${assistantId}/install`,
    method: "POST",
    data: payload,
  })
}

export async function uninstallAssistant(assistantId: string) {
  if (isTauriRuntime()) {
    await invokeTauri<void>("uninstall_local_assistant", { assistant_id: assistantId })
    return
  }

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
  if (isTauriRuntime()) {
    const data = await invokeTauri<AssistantInstallItem>("update_local_assistant_install", {
      assistant_id: assistantId,
      payload: {
        alias: payload.alias ?? null,
        icon_override: payload.icon_override ?? null,
        pinned_version_id: payload.pinned_version_id ?? null,
        follow_latest: payload.follow_latest ?? null,
        is_enabled: payload.is_enabled ?? null,
        sort_order: payload.sort_order ?? null,
      },
    })
    return AssistantInstallItemSchema.parse(data)
  }

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
  share_to_market?: boolean
  version: {
    name: string
    description?: string | null
    system_prompt: string
    tags?: string[]
  }
}) {
  if (isTauriRuntime()) {
    if (payload.share_to_market) {
      throw cloudOnlyOperationError("share assistant to market")
    }
    if (payload.visibility === "public") {
      throw cloudOnlyOperationError("set assistant visibility to public")
    }

    const id = await invokeTauri<string>("create_local_assistant", {
      payload: {
        name: payload.version.name,
        description: payload.summary ?? payload.version.description ?? null,
        avatar: payload.icon_id ?? null,
        system_prompt: payload.version.system_prompt,
        model_config: null,
        tags: payload.version.tags ?? [],
        visibility: "private",
        source: "local",
        cloud_id: null,
      },
    })
    return getLocalAssistantDTOById(id)
  }

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
      tags?: string[]
      changelog?: string | null
    }
  }
) {
  if (isTauriRuntime()) {
    if (payload.visibility === "public") {
      throw cloudOnlyOperationError("set assistant visibility to public")
    }

    await invokeTauri("update_local_assistant", {
      id: assistantId,
      payload: {
        name: payload.version?.name,
        description:
          payload.summary !== undefined ? payload.summary : payload.version?.description,
        avatar: payload.icon_id,
        system_prompt: payload.version?.system_prompt,
        model_config: null,
        tags: payload.version?.tags,
        visibility: payload.visibility,
        source: "local",
        cloud_id: null,
      },
    })
    return getLocalAssistantDTOById(assistantId)
  }

  const data = await request({
    url: `${ASSISTANTS_BASE}/${assistantId}`,
    method: "PATCH",
    data: payload,
  })
  return AssistantDTOSchema.parse(data)
}

export async function deleteAssistant(assistantId: string) {
  if (isTauriRuntime()) {
    await invokeTauri<void>("delete_local_assistant", { id: assistantId })
    return
  }

  return request({
    url: `${ASSISTANTS_BASE}/${assistantId}`,
    method: "DELETE",
  })
}

export async function submitAssistantForReview(assistantId: string) {
  if (isTauriRuntime()) {
    throw cloudOnlyOperationError("submit assistant for review")
  }

  const data = await request({
    url: `${ASSISTANTS_BASE}/${assistantId}/submit`,
    method: "POST",
  })
  return assistantMessageResponseSchema.parse(data)
}
