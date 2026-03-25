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
  tags: z.array(z.string()).default([]),
  discoverable: z.boolean(),
  is_enabled: z.boolean(),
  is_deleted: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
})

export const CustomTaskAgentBindableToolSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  status: z.string(),
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
  tags?: string[]
  discoverable?: boolean
  is_enabled?: boolean
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
