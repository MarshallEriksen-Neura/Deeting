"use client"

import type {
  CustomTaskAgentInvocationKind,
  UpsertCustomTaskAgentPayload,
} from "@/lib/api/custom-task-agents"
import type { TaskAgentImageConfigDraft } from "./task-agent-image-config"
import type { TaskAgentVoiceConfigDraft } from "./task-agent-voice-config"

export type TaskAgentDraft = {
  name: string
  description: string
  task_prompt: string
  invocation_kind: CustomTaskAgentInvocationKind
  preferred_for_image_generation: boolean
  model: string
  provider_model_id: string
  image_config: TaskAgentImageConfigDraft
  voice_config: TaskAgentVoiceConfigDraft
  model_config_json: string
  callable_mcp_tool_ids: string[]
  guidance_skill_ids: string[]
  bound_asset_id: string
  tags_input: string
  discoverable: boolean
  is_enabled: boolean
}

export type PreviewDraft = {
  message: string
  temperature: string
  max_tokens: string
  max_rounds: string
}

export type TaskAgentModelOption = {
  value: string
  modelId: string
  providerModelId: string
}

export type DraftPayload = UpsertCustomTaskAgentPayload
