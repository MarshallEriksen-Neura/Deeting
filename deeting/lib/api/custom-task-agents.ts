import { z } from "zod"

import { isTauriRuntime } from "./desktop-config"

async function invokeTauri<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<T>(command, args)
}

export const CustomTaskAgentInvocationKindSchema = z.enum([
  "chat",
  "image_generation",
  "text_to_speech",
])

export const CustomTaskAgentModelConfigSchema = z
  .record(z.string(), z.unknown())
  .nullish()

export const CustomTaskAgentProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullish(),
  task_prompt: z.string(),
  invocation_kind: CustomTaskAgentInvocationKindSchema,
  preferred_for_image_generation: z.boolean().default(false),
  model_config: CustomTaskAgentModelConfigSchema,
  callable_mcp_tool_ids: z.array(z.string()).default([]),
  guidance_skill_ids: z.array(z.string()).default([]),
  callable_skill_action_refs: z
    .array(
      z.object({
        skill_id: z.string(),
        action_id: z.string(),
      }),
    )
    .default([]),
  bound_asset_id: z.string().nullish(),
  tags: z.array(z.string()).default([]),
  discoverable: z.boolean(),
  is_enabled: z.boolean(),
  is_deleted: z.boolean(),
  source_kind: z.string().nullish(),
  source_path: z.string().nullish(),
  source_repo: z.string().nullish(),
  source_ref: z.string().nullish(),
  source_hash: z.string().nullish(),
  created_at: z.string(),
  updated_at: z.string(),
})

export const CustomTaskAgentBindableToolSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  status: z.string(),
  server_name: z.string().nullish(),
})

export const CustomTaskAgentBindableSkillSchema = z.object({
  skill_id: z.string(),
  installed_version: z.string().nullish(),
  is_enabled: z.boolean(),
  runtime: z.string().nullish(),
})

export const CustomTaskAgentBindableSkillActionSchema = z.object({
  skill_id: z.string(),
  action_id: z.string(),
  callable_name: z.string(),
  description: z.string(),
  runtime: z.string(),
  entry_path: z.string(),
  input_schema: z.unknown().nullish(),
})

export const CustomTaskAgentBindingCatalogSchema = z.object({
  mcp_tools: z.array(CustomTaskAgentBindableToolSchema).default([]),
  guidance_skills: z.array(CustomTaskAgentBindableSkillSchema).default([]),
  skill_actions: z.array(CustomTaskAgentBindableSkillActionSchema).default([]),
})

export const CustomTaskAgentPreviewResponseSchema = z.object({
  status: z.string(),
  content: z.string(),
  model_id: z.string(),
  provider_model_id: z.string(),
  invocation_kind: CustomTaskAgentInvocationKindSchema,
  reasoning_content: z.string().nullish(),
  tool_calls: z.array(z.unknown()).default([]),
  tool_trace: z.array(z.unknown()).default([]),
  callable_mcp_tool_ids: z.array(z.string()).default([]),
  guidance_skill_ids: z.array(z.string()).default([]),
  callable_skill_action_refs: z
    .array(
      z.object({
        skill_id: z.string(),
        action_id: z.string(),
      }),
    )
    .default([]),
  images: z.array(z.string()).default([]),
  audios: z.array(z.string()).default([]),
  raw: z.unknown().nullish(),
})

export const ClaudeAgentImportPreviewItemSchema = z.object({
  source_path: z.string(),
  relative_path: z.string(),
  name: z.string(),
  description: z.string().nullish(),
  tags: z.array(z.string()).default([]),
  inferred_mcp_tool_ids: z.array(z.string()).default([]),
  inferred_guidance_skill_ids: z.array(z.string()).default([]),
  exists: z.boolean(),
  existing_agent_id: z.string().nullish(),
  existing_agent_name: z.string().nullish(),
})

export const ClaudeAgentImportPreviewResponseSchema = z.object({
  root_path: z.string(),
  items: z.array(ClaudeAgentImportPreviewItemSchema).default([]),
})

export const ImportClaudeAgentsResponseSchema = z.object({
  root_path: z.string(),
  created_count: z.number(),
  updated_count: z.number(),
  profiles: z.array(CustomTaskAgentProfileSchema).default([]),
})

export const ExternalAgentCandidateSchema = z.object({
  source_kind: z.string(),
  source_path: z.string(),
  relative_path: z.string(),
  name: z.string(),
  description: z.string().nullish(),
  task_prompt: z.string(),
  tags: z.array(z.string()).default([]),
  inferred_mcp_tool_ids: z.array(z.string()).default([]),
  inferred_guidance_skill_ids: z.array(z.string()).default([]),
  model_config: CustomTaskAgentModelConfigSchema,
  source_hash: z.string(),
  exists: z.boolean(),
  existing_agent_id: z.string().nullish(),
  existing_agent_name: z.string().nullish(),
})

export const ScanExternalAgentsResponseSchema = z.object({
  roots: z.array(z.string()).default([]),
  candidates: z.array(ExternalAgentCandidateSchema).default([]),
})

export const ImportExternalAgentsResponseSchema = z.object({
  created_count: z.number(),
  updated_count: z.number(),
  profiles: z.array(CustomTaskAgentProfileSchema).default([]),
})

export type CustomTaskAgentInvocationKind = z.infer<
  typeof CustomTaskAgentInvocationKindSchema
>
export type CustomTaskAgentProfile = z.infer<
  typeof CustomTaskAgentProfileSchema
>
export type CustomTaskAgentBindableTool = z.infer<
  typeof CustomTaskAgentBindableToolSchema
>
export type CustomTaskAgentBindableSkill = z.infer<
  typeof CustomTaskAgentBindableSkillSchema
>
export type CustomTaskAgentBindableSkillAction = z.infer<
  typeof CustomTaskAgentBindableSkillActionSchema
>
export type CustomTaskAgentBindingCatalog = z.infer<
  typeof CustomTaskAgentBindingCatalogSchema
>
export type CustomTaskAgentPreviewResponse = z.infer<
  typeof CustomTaskAgentPreviewResponseSchema
>
export type ClaudeAgentImportPreviewItem = z.infer<
  typeof ClaudeAgentImportPreviewItemSchema
>
export type ClaudeAgentImportPreviewResponse = z.infer<
  typeof ClaudeAgentImportPreviewResponseSchema
>
export type ImportClaudeAgentsResponse = z.infer<
  typeof ImportClaudeAgentsResponseSchema
>
export type ExternalAgentCandidate = z.infer<
  typeof ExternalAgentCandidateSchema
>
export type ScanExternalAgentsResponse = z.infer<
  typeof ScanExternalAgentsResponseSchema
>
export type ImportExternalAgentsResponse = z.infer<
  typeof ImportExternalAgentsResponseSchema
>

export interface UploadedClaudeAgentDocument {
  filename: string
  relative_path?: string | null
  content: string
}

export interface UpsertCustomTaskAgentPayload {
  name: string
  description?: string | null
  task_prompt: string
  invocation_kind?: CustomTaskAgentInvocationKind
  preferred_for_image_generation?: boolean
  model_config?: Record<string, unknown> | null
  callable_mcp_tool_ids?: string[]
  guidance_skill_ids?: string[]
  callable_skill_action_refs?: Array<{
    skill_id: string
    action_id: string
  }>
  bound_asset_id?: string | null
  tags?: string[]
  discoverable?: boolean
  is_enabled?: boolean
  source_kind?: string | null
  source_path?: string | null
  source_repo?: string | null
  source_ref?: string | null
  source_hash?: string | null
}

export interface CustomTaskAgentPreviewPayload {
  message: string
  image_urls?: string[]
  temperature?: number | null
  max_tokens?: number | null
  max_rounds?: number | null
}

export function supportsLocalCustomTaskAgents(): boolean {
  return isTauriRuntime()
}

export async function listCustomTaskAgents(): Promise<CustomTaskAgentProfile[]> {
  if (!isTauriRuntime()) {
    return []
  }

  const data = await invokeTauri<unknown>("list_custom_task_agents")
  return z.array(CustomTaskAgentProfileSchema).parse(data)
}

export async function getCustomTaskAgent(
  agentId: string,
): Promise<CustomTaskAgentProfile> {
  const data = await invokeTauri<unknown>("get_custom_task_agent", {
    agentId,
  })
  return CustomTaskAgentProfileSchema.parse(data)
}

export async function getCustomTaskAgentBindingCatalog(): Promise<CustomTaskAgentBindingCatalog> {
  if (!isTauriRuntime()) {
    return CustomTaskAgentBindingCatalogSchema.parse({
      mcp_tools: [],
      guidance_skills: [],
      skill_actions: [],
    })
  }

  const data = await invokeTauri<unknown>(
    "get_custom_task_agent_binding_catalog",
  )
  return CustomTaskAgentBindingCatalogSchema.parse(data)
}

export async function createCustomTaskAgent(
  payload: UpsertCustomTaskAgentPayload,
): Promise<CustomTaskAgentProfile> {
  const data = await invokeTauri<unknown>("create_custom_task_agent", {
    payload,
  })
  return CustomTaskAgentProfileSchema.parse(data)
}

export async function updateCustomTaskAgent(
  agentId: string,
  payload: UpsertCustomTaskAgentPayload,
): Promise<CustomTaskAgentProfile> {
  const data = await invokeTauri<unknown>("update_custom_task_agent", {
    agentId,
    payload,
  })
  return CustomTaskAgentProfileSchema.parse(data)
}

export async function deleteCustomTaskAgent(agentId: string): Promise<void> {
  await invokeTauri<void>("delete_custom_task_agent", {
    agentId,
  })
}

export async function previewCustomTaskAgent(
  agentId: string,
  payload: CustomTaskAgentPreviewPayload,
): Promise<CustomTaskAgentPreviewResponse> {
  const data = await invokeTauri<unknown>("preview_custom_task_agent", {
    agentId,
    payload: {
      message: payload.message,
      image_urls: payload.image_urls ?? [],
      temperature: payload.temperature ?? null,
      max_tokens: payload.max_tokens ?? null,
      max_rounds: payload.max_rounds ?? null,
    },
  })
  return CustomTaskAgentPreviewResponseSchema.parse(data)
}

export async function reindexCustomTaskAgents(): Promise<void> {
  await invokeTauri<void>("reindex_custom_task_agents")
}

async function readUploadedClaudeAgentDocuments(
  files: File[],
): Promise<UploadedClaudeAgentDocument[]> {
  const documents = await Promise.all(
    files.map(async (file) => {
      const relativePath =
        "webkitRelativePath" in file && typeof file.webkitRelativePath === "string"
          ? file.webkitRelativePath.trim()
          : ""
      const content =
        typeof file.text === "function"
          ? await file.text()
          : await new Promise<string>((resolve, reject) => {
              const reader = new FileReader()
              reader.onload = () =>
                resolve(typeof reader.result === "string" ? reader.result : "")
              reader.onerror = () =>
                reject(reader.error ?? new Error("failed to read import file"))
              reader.readAsText(file)
            })
      return {
        filename: file.name,
        relative_path: relativePath || file.name,
        content,
      }
    }),
  )
  return documents
}

export async function previewClaudeAgentImport(payload?: {
  files?: File[]
}): Promise<ClaudeAgentImportPreviewResponse> {
  const documents = payload?.files?.length
    ? await readUploadedClaudeAgentDocuments(payload.files)
    : []
  const data = await invokeTauri<unknown>("preview_claude_agent_import", {
    payload: {
      documents,
    },
  })
  return ClaudeAgentImportPreviewResponseSchema.parse(data)
}

export async function importClaudeAgents(payload?: {
  files?: File[]
}): Promise<ImportClaudeAgentsResponse> {
  const documents = payload?.files?.length
    ? await readUploadedClaudeAgentDocuments(payload.files)
    : []
  const data = await invokeTauri<unknown>("import_claude_agents", {
    payload: {
      documents,
    },
  })
  return ImportClaudeAgentsResponseSchema.parse(data)
}

export async function scanExternalTaskAgents(payload?: {
  roots?: string[]
  include_user_defaults?: boolean
}): Promise<ScanExternalAgentsResponse> {
  const data = await invokeTauri<unknown>("scan_external_task_agents", {
    payload: {
      roots: payload?.roots ?? [],
      include_user_defaults: payload?.include_user_defaults ?? true,
    },
  })
  return ScanExternalAgentsResponseSchema.parse(data)
}

export async function importExternalTaskAgents(payload: {
  candidates: ExternalAgentCandidate[]
}): Promise<ImportExternalAgentsResponse> {
  const data = await invokeTauri<unknown>("import_external_task_agents", {
    payload,
  })
  return ImportExternalAgentsResponseSchema.parse(data)
}
