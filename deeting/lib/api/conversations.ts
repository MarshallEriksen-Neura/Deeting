import { z } from "zod"

import {
  deleteDesktopObjectStorageObject,
  fetchDesktopObjectStorageConfig,
} from "@/lib/api/desktop-object-storage"
import { parseMessageContent } from "@/lib/chat/message-content"
import { handleModelConfigRequiredError } from "@/lib/model-config-required"

const isTauriRuntime = () =>
  process.env.NEXT_PUBLIC_IS_TAURI === "true" &&
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core")
  try {
    return await invoke<T>(command, args)
  } catch (error) {
    handleModelConfigRequiredError(error)
    throw error
  }
}

export const ConversationMessageSchema = z.object({
  role: z.string(),
  content: z.any().nullable().optional(),
  turn_index: z.number().int().nullable().optional(),
  created_at: z.string().nullable().optional(),
  is_truncated: z.boolean().nullable().optional(),
  name: z.string().nullable().optional(),
  meta_info: z.record(z.string(), z.any()).nullable().optional(),
}).passthrough()

export const ConversationWindowSchema = z.object({
  session_id: z.string(),
  messages: z.array(ConversationMessageSchema).default([]),
  meta: z.record(z.string(), z.any()).nullable().optional(),
  summary: z.record(z.string(), z.any()).nullable().optional(),
})

export type ConversationMessage = z.infer<typeof ConversationMessageSchema>
export type ConversationWindow = z.infer<typeof ConversationWindowSchema>

export const ConversationExecutionRootSchema = z.object({
  root_execution_id: z.string(),
  session_id: z.string(),
  message_id: z.string(),
  turn_index: z.number().int(),
  schema_version: z.number().int(),
  execution_id: z.string(),
  execution_kind: z.string(),
  execution_status: z.string(),
  terminal_status: z.string(),
  target_id: z.string().nullable().optional(),
  target_name: z.string().nullable().optional(),
  target_invocation_kind: z.string().nullable().optional(),
  target_worker_ref: z.string().nullable().optional(),
  target_workflow_run_id: z.string().nullable().optional(),
  selection: z.record(z.string(), z.any()).nullable().optional(),
  available_actions: z.any().nullable().optional(),
  summary: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
  result_payload: z.record(z.string(), z.any()).nullable().optional(),
  raw_json: z.record(z.string(), z.any()).nullable().optional(),
  started_at_ms: z.number().int().nullable().optional(),
  completed_at_ms: z.number().int().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
})

export const ConversationExecutionChildSchema = z.object({
  id: z.string(),
  root_execution_id: z.string(),
  session_id: z.string(),
  message_id: z.string(),
  phase_id: z.string().nullable().optional(),
  step_type: z.string().nullable().optional(),
  title: z.string(),
  status: z.string(),
  worker_ref: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
  available_actions: z.any().nullable().optional(),
  raw_json: z.record(z.string(), z.any()).nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
})

export const ConversationExecutionTreeSchema = z.object({
  root: ConversationExecutionRootSchema,
  children: z.array(ConversationExecutionChildSchema).default([]),
})

export type ConversationExecutionRoot = z.infer<typeof ConversationExecutionRootSchema>
export type ConversationExecutionChild = z.infer<typeof ConversationExecutionChildSchema>
export type ConversationExecutionTree = z.infer<typeof ConversationExecutionTreeSchema>

function buildExecutionLifecyclePayloadFromPersistedTreeRecord(
  tree: ConversationExecutionTree
): Record<string, unknown> {
  const rawPayload =
    tree.root.raw_json && typeof tree.root.raw_json === "object" ? tree.root.raw_json : null
  const children = tree.children.map((child) => ({
    id: child.id,
    phase_id: child.phase_id ?? undefined,
    step_type: child.step_type ?? undefined,
    title: child.title,
    status: child.status,
    worker_ref: child.worker_ref ?? undefined,
    summary: child.summary ?? undefined,
    error: child.error ?? undefined,
    available_actions: Array.isArray(child.available_actions)
      ? child.available_actions
      : [],
  }))
  const resultPayload =
    tree.root.result_payload && typeof tree.root.result_payload === "object"
      ? tree.root.result_payload
      : null
  const delegatedResult =
    rawPayload &&
    typeof rawPayload === "object" &&
    rawPayload.delegated_result &&
    typeof rawPayload.delegated_result === "object"
      ? rawPayload.delegated_result
      : {
          type: "delegated_result",
          schema_version: 1,
          kind: tree.root.execution_kind,
          authoritative: tree.root.terminal_status === "succeeded",
          status: tree.root.terminal_status,
          execution_id: tree.root.execution_id,
          target: {
            id: tree.root.target_id ?? undefined,
            name: tree.root.target_name ?? undefined,
            invocation_kind: tree.root.target_invocation_kind ?? undefined,
            worker_ref: tree.root.target_worker_ref ?? undefined,
            workflow_run_id: tree.root.target_workflow_run_id ?? undefined,
          },
          selection:
            tree.root.selection && typeof tree.root.selection === "object"
              ? {
                  explicit:
                    typeof tree.root.selection.explicit === "boolean"
                      ? tree.root.selection.explicit
                      : undefined,
                  score:
                    typeof tree.root.selection.score === "number"
                      ? tree.root.selection.score
                      : null,
                  reason_codes: Array.isArray(tree.root.selection.reason_codes)
                    ? (tree.root.selection.reason_codes as string[])
                    : undefined,
                  reason_text:
                    typeof tree.root.selection.reason_text === "string"
                      ? tree.root.selection.reason_text
                      : null,
                }
              : undefined,
          available_actions: Array.isArray(tree.root.available_actions)
            ? tree.root.available_actions
            : [],
          summary: tree.root.summary ?? undefined,
          steps: children,
          primary_output: resultPayload,
          error: tree.root.error ?? undefined,
        }

  return {
    schema_version: tree.root.schema_version,
    root_execution_id: tree.root.root_execution_id,
    execution_id: tree.root.execution_id,
    execution_kind: tree.root.execution_kind,
    execution_status: tree.root.execution_status,
    terminal_status: tree.root.terminal_status,
    persisted_snapshot: true,
    target: {
      id: tree.root.target_id ?? undefined,
      name: tree.root.target_name ?? undefined,
      invocation_kind: tree.root.target_invocation_kind ?? undefined,
      worker_ref: tree.root.target_worker_ref ?? undefined,
      workflow_run_id: tree.root.target_workflow_run_id ?? undefined,
    },
    selection:
      tree.root.selection && typeof tree.root.selection === "object"
        ? {
            explicit:
              typeof tree.root.selection.explicit === "boolean"
                ? tree.root.selection.explicit
                : undefined,
            score:
              typeof tree.root.selection.score === "number"
                ? tree.root.selection.score
                : null,
            reason_codes: Array.isArray(tree.root.selection.reason_codes)
              ? (tree.root.selection.reason_codes as string[])
              : undefined,
            reason_text:
              typeof tree.root.selection.reason_text === "string"
                ? tree.root.selection.reason_text
                : null,
          }
        : undefined,
    available_actions: Array.isArray(tree.root.available_actions)
      ? tree.root.available_actions
      : [],
    summary: tree.root.summary ?? undefined,
    error: tree.root.error ?? undefined,
    delegated_result: delegatedResult,
    children,
  }
}

function assertTauriConversationRuntime() {
  if (!isTauriRuntime()) {
    throw new Error("Conversation APIs are only available in Tauri runtime")
  }
}

export async function fetchConversationWindow(sessionId: string): Promise<ConversationWindow> {
  assertTauriConversationRuntime()
  try {
    const data = await invokeTauri<ConversationWindow>("get_local_conversation_window", {
      sessionId,
    })
    return ConversationWindowSchema.parse(data)
  } catch {
    const history = await invokeTauri<ConversationHistoryResponse>(
      "list_local_conversation_history",
      { query: { session_id: sessionId, limit: 200 } }
    )
    return ConversationWindowSchema.parse({
      session_id: sessionId,
      messages: history.messages ?? [],
      meta: null,
      summary: null,
    })
  }
}

export const ConversationHistoryResponseSchema = z.object({
  session_id: z.string(),
  messages: z.array(ConversationMessageSchema).default([]),
  next_cursor: z.number().int().nullable().optional(),
  has_more: z.boolean().default(false),
})

export type ConversationHistoryResponse = z.infer<typeof ConversationHistoryResponseSchema>

export async function getConversationExecutionTree(
  rootExecutionId: string
): Promise<ConversationExecutionTree> {
  if (!isTauriRuntime()) {
    throw new Error("Conversation execution tree is only available in Tauri runtime")
  }
  const data = await invokeTauri<ConversationExecutionTree>(
    "get_local_conversation_execution_tree",
    { rootExecutionId }
  )
  return ConversationExecutionTreeSchema.parse(data)
}

export async function listConversationExecutionRoots(
  sessionId: string
): Promise<ConversationExecutionRoot[]> {
  if (!isTauriRuntime()) {
    throw new Error("Conversation execution roots are only available in Tauri runtime")
  }
  const data = await invokeTauri<ConversationExecutionRoot[]>(
    "list_local_conversation_execution_roots",
    { sessionId }
  )
  return z.array(ConversationExecutionRootSchema).parse(data)
}

const isConversationMessageLike = (value: unknown): value is ConversationMessage =>
  value !== null && typeof value === "object" && "role" in value

const normalizeConversationHistoryPayload = (
  sessionId: string,
  payload: unknown
): ConversationHistoryResponse => {
  if (Array.isArray(payload)) {
    return {
      session_id: sessionId,
      messages: payload.filter(isConversationMessageLike),
      next_cursor: null,
      has_more: false,
    }
  }

  if (!payload || typeof payload !== "object") {
    return { session_id: sessionId, messages: [], next_cursor: null, has_more: false }
  }

  const record = payload as Record<string, unknown>
  const rawMessages = Array.isArray(record.messages) ? record.messages : []
  const nextCursor =
    typeof record.next_cursor === "number"
      ? record.next_cursor
      : typeof record.next_cursor === "string" && record.next_cursor.trim()
        ? Number(record.next_cursor)
        : null

  return {
    session_id:
      typeof record.session_id === "string" && record.session_id.trim()
        ? record.session_id
        : sessionId,
    messages: rawMessages.filter(isConversationMessageLike),
    next_cursor: Number.isFinite(nextCursor) ? nextCursor : null,
    has_more: typeof record.has_more === "boolean" ? record.has_more : false,
  }
}

const asTrimmedString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null

const asStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined
  const items = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0)
  return items.length > 0 ? items : undefined
}

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

const extractRootExecutionIdFromLifecycleBlock = (block: unknown): string | null => {
  const blockRecord = asRecord(block)
  if (!blockRecord) return null
  if (asTrimmedString(blockRecord.type) !== "ui") return null
  if (asTrimmedString(blockRecord.viewType) !== "execution.lifecycle") return null
  const payload = asRecord(blockRecord.payload)
  return asTrimmedString(payload?.root_execution_id)
}

const extractRootExecutionIdFromConversationMessage = (
  message: ConversationMessage
): string | null => {
  const meta = asRecord(message.meta_info)
  const blocks = Array.isArray(meta?.blocks) ? meta.blocks : []

  for (const block of blocks) {
    const rootExecutionId = extractRootExecutionIdFromLifecycleBlock(block)
    if (rootExecutionId) {
      return rootExecutionId
    }
  }

  return asTrimmedString(asRecord(meta?.execution_tree)?.root_execution_id)
}

const applyPersistedExecutionTreeToConversationMessage = (
  message: ConversationMessage,
  executionTree: Record<string, unknown>
): ConversationMessage => {
  const meta = asRecord(message.meta_info) ?? {}
  const nextMetaInfo: Record<string, unknown> = {
    ...meta,
    execution_tree: executionTree,
  }

  const rootExecutionId = asTrimmedString(executionTree.root_execution_id)
  const existingBlocks = Array.isArray(meta.blocks) ? [...meta.blocks] : []
  const nextExecutionBlock = {
    ...(existingBlocks.find((block) => extractRootExecutionIdFromLifecycleBlock(block) === rootExecutionId)
      ? asRecord(existingBlocks.find((block) => extractRootExecutionIdFromLifecycleBlock(block) === rootExecutionId)) ?? {}
      : {}),
    type: "ui",
    viewType: "execution.lifecycle",
    payload: executionTree,
  }

  if (existingBlocks.length === 0) {
    nextMetaInfo.blocks = [nextExecutionBlock]
  } else {
    const existingIndex = existingBlocks.findIndex((block) => {
      const blockRecord = asRecord(block)
      if (!blockRecord) return false
      if (asTrimmedString(blockRecord.type) !== "ui") return false
      if (asTrimmedString(blockRecord.viewType) !== "execution.lifecycle") return false
      const blockRootExecutionId = extractRootExecutionIdFromLifecycleBlock(blockRecord)
      return blockRootExecutionId === rootExecutionId || !blockRootExecutionId
    })

    if (existingIndex >= 0) {
      existingBlocks[existingIndex] = {
        ...(asRecord(existingBlocks[existingIndex]) ?? {}),
        ...nextExecutionBlock,
      }
    } else {
      existingBlocks.push(nextExecutionBlock)
    }
    nextMetaInfo.blocks = existingBlocks
  }

  return {
    ...message,
    meta_info: nextMetaInfo,
  }
}

async function hydratePersistedExecutionTreesInHistory(
  response: ConversationHistoryResponse
): Promise<ConversationHistoryResponse> {
  if (response.messages.length === 0) return response

  const rootIds = Array.from(
    new Set(
      response.messages
        .map((message) => extractRootExecutionIdFromConversationMessage(message))
        .filter((value): value is string => typeof value === "string" && value.length > 0)
    )
  )
  if (rootIds.length === 0) return response

  const persistedTrees = new Map<string, Record<string, unknown>>()
  const settled = await Promise.allSettled(
    rootIds.map(async (rootExecutionId) => {
      const tree = await getConversationExecutionTree(rootExecutionId)
      return [rootExecutionId, buildExecutionLifecyclePayloadFromPersistedTreeRecord(tree)] as const
    })
  )

  for (const result of settled) {
    if (result.status !== "fulfilled") continue
    persistedTrees.set(result.value[0], result.value[1])
  }

  if (persistedTrees.size === 0) return response

  return {
    ...response,
    messages: response.messages.map((message) => {
      const rootExecutionId = extractRootExecutionIdFromConversationMessage(message)
      if (!rootExecutionId) return message
      const executionTree = persistedTrees.get(rootExecutionId)
      if (!executionTree) return message
      return applyPersistedExecutionTreeToConversationMessage(message, executionTree)
    }),
  }
}

export async function fetchConversationHistory(
  sessionId: string,
  options: {
    cursor?: number
    limit?: number
    includePendingApprovals?: boolean
    includePersistedExecutionTrees?: boolean
  } = {}
): Promise<ConversationHistoryResponse> {
  assertTauriConversationRuntime()
  try {
    const data = await invokeTauri<ConversationHistoryResponse>(
      "list_local_conversation_history",
      {
        query: {
          session_id: sessionId,
          cursor: options.cursor ?? null,
          limit: options.limit ?? null,
        },
      }
    )
    const normalized = normalizeConversationHistoryPayload(sessionId, data)
    const parsed = ConversationHistoryResponseSchema.safeParse(data)
    let response = parsed.success ? parsed.data : normalized
    if (options.includePersistedExecutionTrees !== false) {
      response = await hydratePersistedExecutionTreesInHistory(response)
    }
    return response
  } catch {
    return { session_id: sessionId, messages: [], next_cursor: null, has_more: false }
  }
}

export const ConversationSessionItemSchema = z.object({
  session_id: z.string(),
  title: z.string().nullable().optional(),
  summary_text: z.string().nullable().optional(),
  message_count: z.number().int().optional().default(0),
  first_message_at: z.string().nullable().optional(),
  last_active_at: z.string().nullable().optional(),
})

export const ConversationSessionPageSchema = z.object({
  items: z.array(ConversationSessionItemSchema),
  next_page: z.string().nullable().optional(),
  previous_page: z.string().nullable().optional(),
})

export type ConversationSessionItem = z.infer<typeof ConversationSessionItemSchema>
export type ConversationSessionPage = z.infer<typeof ConversationSessionPageSchema>

export type ConversationSessionStatus = "active" | "archived" | "closed"

export const ConversationCreateResponseSchema = z.object({
  session_id: z.string(),
  title: z.string().nullable().optional(),
})

export type ConversationCreateResponse = z.infer<typeof ConversationCreateResponseSchema>

export type ConversationCreateRequest = {
  assistant_id?: string | null
  title?: string | null
}

export const ConversationArchiveResponseSchema = z.object({
  session_id: z.string(),
  status: z.enum(["active", "archived", "closed"]),
})

export type ConversationArchiveResponse = z.infer<typeof ConversationArchiveResponseSchema>

export const ConversationRenameResponseSchema = z.object({
  session_id: z.string(),
  title: z.string().nullable().optional(),
})

export type ConversationRenameResponse = z.infer<typeof ConversationRenameResponseSchema>

export const ConversationDeleteResponseSchema = z.object({
  session_id: z.string(),
  turn_index: z.number().int(),
  deleted: z.boolean(),
})

export type ConversationDeleteResponse = z.infer<typeof ConversationDeleteResponseSchema>

export const ConversationClearResponseSchema = z.object({
  session_id: z.string(),
  cleared: z.boolean(),
})

export type ConversationClearResponse = z.infer<typeof ConversationClearResponseSchema>

export const ConversationRegenerateResponseSchema = z.object({
  session_id: z.string(),
  deleted_turn_index: z.number().int().nullable().optional(),
  message: ConversationMessageSchema,
})

export type ConversationRegenerateResponse = z.infer<typeof ConversationRegenerateResponseSchema>

export type ConversationRegenerateRequest = {
  model: string
  provider_model_id?: string | null
  temperature?: number
  top_p?: number
  max_tokens?: number
  request_id?: string | null
}

export type ConversationSessionsQuery = {
  cursor?: string | null
  size?: number
  assistant_id?: string | null
  status?: ConversationSessionStatus
}

export async function fetchConversationSessions(
  query: ConversationSessionsQuery
): Promise<ConversationSessionPage> {
  assertTauriConversationRuntime()
  const data = await invokeTauri<ConversationSessionPage>("list_local_conversations", {
    query: {
      cursor: query.cursor ?? null,
      size: query.size ?? null,
      assistant_id: query.assistant_id ?? null,
      status: query.status ?? "active",
    },
  })
  return ConversationSessionPageSchema.parse(data)
}

export async function createConversation(
  payload: ConversationCreateRequest = {}
): Promise<ConversationCreateResponse> {
  assertTauriConversationRuntime()
  const data = await invokeTauri<ConversationCreateResponse>("create_local_conversation", {
    payload: {
      assistant_id: payload.assistant_id ?? null,
      title: payload.title ?? null,
    },
  })
  return ConversationCreateResponseSchema.parse(data)
}

export async function archiveConversation(sessionId: string): Promise<ConversationArchiveResponse> {
  assertTauriConversationRuntime()
  const data = await invokeTauri<ConversationArchiveResponse>("archive_local_conversation", {
    sessionId,
  })
  return ConversationArchiveResponseSchema.parse(data)
}

export async function unarchiveConversation(sessionId: string): Promise<ConversationArchiveResponse> {
  assertTauriConversationRuntime()
  const data = await invokeTauri<ConversationArchiveResponse>("unarchive_local_conversation", {
    sessionId,
  })
  return ConversationArchiveResponseSchema.parse(data)
}

export async function renameConversation(
  sessionId: string,
  title: string
): Promise<ConversationRenameResponse> {
  assertTauriConversationRuntime()
  const data = await invokeTauri<ConversationRenameResponse>("rename_local_conversation", {
    sessionId,
    payload: { title },
  })
  return ConversationRenameResponseSchema.parse(data)
}

export async function deleteConversationMessage(
  sessionId: string,
  turnIndex: number
): Promise<ConversationDeleteResponse> {
  assertTauriConversationRuntime()
  try {
    const history = await fetchConversationHistory(sessionId, {
      limit: 500,
      includePendingApprovals: false,
      includePersistedExecutionTrees: false,
    })
    const targetMessages = (history.messages ?? []).filter(
      (message) => message.turn_index === turnIndex
    )
    await cleanupDesktopObjectStorageAssetsForMessages(targetMessages)
  } catch {
    // best-effort cleanup
  }
  const data = await invokeTauri<ConversationDeleteResponse>("delete_local_conversation_message", {
    sessionId,
    turnIndex,
  })
  return ConversationDeleteResponseSchema.parse(data)
}

export async function updateConversationAssistantMetaInfo(
  sessionId: string,
  turnIndex: number,
  metaInfo: Record<string, unknown> | null
): Promise<void> {
  assertTauriConversationRuntime()
  await invokeTauri("update_local_conversation_assistant_meta_info", {
    sessionId,
    turnIndex,
    metaInfo,
  })
}

const LOCAL_ASSET_RE = /local-asset:\/\/([a-f0-9]{64})/g

const normalizeDesktopObjectStorageKeyFromUrl = (
  url: string,
  publicBaseUrl: string
): string | null => {
  const normalizedBase = publicBaseUrl.trim().replace(/\/+$/, "")
  const normalizedUrl = url.trim()
  if (!normalizedBase || !normalizedUrl.startsWith(`${normalizedBase}/`)) {
    return null
  }
  const relative = normalizedUrl.slice(normalizedBase.length + 1).replace(/^\/+/, "")
  return relative || null
}

async function cleanupDesktopObjectStorageAssetsForMessages(
  messages: ConversationMessage[]
): Promise<void> {
  try {
    const config = await fetchDesktopObjectStorageConfig()
    const publicBaseUrl = config?.public_base_url?.trim() ?? ""

    const objectKeys = new Set<string>()
    for (const msg of messages) {
      const parsed = parseMessageContent(msg.content)
      for (const attachment of parsed.attachments) {
        const directObjectKey = attachment.objectKey?.trim()
        if (directObjectKey) {
          objectKeys.add(directObjectKey)
          continue
        }
        const url = attachment.url?.trim()
        if (!url || !publicBaseUrl) continue
        const objectKey = normalizeDesktopObjectStorageKeyFromUrl(url, publicBaseUrl)
        if (objectKey) {
          objectKeys.add(objectKey)
        }
      }
    }

    if (!objectKeys.size) return

    await Promise.allSettled(
      Array.from(objectKeys).map((objectKey) => deleteDesktopObjectStorageObject(objectKey))
    )
  } catch {
    // best-effort cleanup
  }
}

async function cleanupLocalAssetsForConversation(sessionId: string): Promise<void> {
  try {
    const history = await fetchConversationHistory(sessionId, {
      limit: 500,
      includePendingApprovals: false,
      includePersistedExecutionTrees: false,
    })
    const sha256Set = new Set<string>()
    for (const msg of history.messages ?? []) {
      const content = typeof msg.content === "string" ? msg.content : ""
      for (const match of content.matchAll(LOCAL_ASSET_RE)) {
        sha256Set.add(match[1])
      }
    }
    if (sha256Set.size > 0) {
      await invokeTauri("cleanup_conversation_chat_assets", {
        sha256List: Array.from(sha256Set),
      })
    }
    await cleanupDesktopObjectStorageAssetsForMessages(history.messages ?? [])
  } catch {
    // best-effort cleanup
  }
}

export async function clearConversation(sessionId: string): Promise<ConversationClearResponse> {
  assertTauriConversationRuntime()
  await cleanupLocalAssetsForConversation(sessionId)
  const data = await invokeTauri<ConversationClearResponse>("clear_local_conversation", {
    sessionId,
  })
  return ConversationClearResponseSchema.parse(data)
}

export async function regenerateConversationReply(
  sessionId: string,
  payload: ConversationRegenerateRequest
): Promise<ConversationRegenerateResponse> {
  assertTauriConversationRuntime()
  throw new Error(
    `Conversation regenerate API has been removed from the frontend chat path; use the local streamed regenerate flow for session ${sessionId}`
  )
}
