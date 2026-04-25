import type { CustomTaskAgentProfile } from "@/lib/api/custom-task-agents"
import {
  buildTaskAgentImageConfigDraft,
  createEmptyTaskAgentImageConfigDraft,
} from "./task-agent-image-config"
import {
  buildTaskAgentVoiceConfigDraft,
  createEmptyTaskAgentVoiceConfigDraft,
} from "./task-agent-voice-config"
import type { TaskAgentDraft, PreviewDraft } from "./task-agent-editor-types"

// 鈹€鈹€ Constants 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export const NEW_AGENT_ID = "__new_custom_task_agent__"
export const DEFAULT_TASK_AGENT_MODEL_VALUE = "__task_agent_model_default__"
export const INTERNAL_IMAGE_AGENT_TASK_PROMPT =
  "Generate images from the user's current chat request and attachments."
export const INTERNAL_TTS_AGENT_TASK_PROMPT =
  "Generate speech audio from the user's current chat request."

export const defaultPreviewDraft: PreviewDraft = {
  message: "",
  temperature: "",
  max_tokens: "",
  max_rounds: "",
}
export type TaskAgentCapabilityHealth = {
  executableToolCount: number
  guidanceSkillCount: number
  hasCallableSurface: boolean
  isGuidanceOnly: boolean
  summaryKey: "ready" | "guidanceOnly" | "empty"
}

export type TaskAgentBindingRecommendations = {
  recommendedToolIds: string[]
  recommendedSkillIds: string[]
}
export function buildTaskAgentCapabilityHealth(input: {
  callable_mcp_tool_ids: string[]
  guidance_skill_ids: string[]
}): TaskAgentCapabilityHealth {
  const executableToolCount = input.callable_mcp_tool_ids.length
  const guidanceSkillCount = input.guidance_skill_ids.length
  const hasCallableSurface = executableToolCount > 0
  const isGuidanceOnly = guidanceSkillCount > 0 && !hasCallableSurface
  const summaryKey = hasCallableSurface
    ? "ready"
    : isGuidanceOnly
      ? "guidanceOnly"
      : "empty"

  return {
    executableToolCount,
    guidanceSkillCount,
    hasCallableSurface,
    isGuidanceOnly,
    summaryKey,
  }
}


function containsAny(text: string, patterns: string[]): boolean {
  return patterns.some((pattern) => text.includes(pattern))
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values))
}

function matchRecommendedToolIds(
  tools: Array<{ id: string; name: string; description: string }>,
  patterns: string[],
): string[] {
  return tools
    .filter((tool) => {
      const haystack = `${tool.id} ${tool.name} ${tool.description}`.toLowerCase()
      return patterns.some((pattern) => haystack.includes(pattern.toLowerCase()))
    })
    .map((tool) => tool.id)
}

function matchRecommendedSkillIds(
  skills: Array<{ skill_id: string }>,
  desiredSkillIds: string[],
): string[] {
  const installed = new Set(skills.map((skill) => skill.skill_id))
  return desiredSkillIds.filter((skillId) => installed.has(skillId))
}

export function buildTaskAgentBindingRecommendations(
  draft: Pick<TaskAgentDraft, "name" | "description" | "task_prompt" | "tags_input">,
  bindingCatalog: {
    mcp_tools: Array<{ id: string; name: string; description: string }>
    guidance_skills: Array<{ skill_id: string }>
  },
): TaskAgentBindingRecommendations {
  const text = [draft.name, draft.description, draft.task_prompt, draft.tags_input]
    .join(" ")
    .toLowerCase()

  const wantsEngineering = containsAny(text, [
    "engineering",
    "developer",
    "backend",
    "frontend",
    "devops",
    "code",
    "cli",
    "terminal",
  ])
  const wantsBrowser = containsAny(text, [
    "browser",
    "web",
    "crawler",
    "scrape",
    "research",
    "search",
    "site",
  ])
  const wantsDesign = containsAny(text, [
    "design",
    "image",
    "visual",
    "ux",
    "ui",
    "brand",
  ])

  const recommendedToolIds: string[] = []
  const recommendedSkillIds: string[] = []

  if (wantsEngineering) {
    recommendedToolIds.push(
      ...matchRecommendedToolIds(bindingCatalog.mcp_tools, ["shell_execute"]),
    )
  }

  if (wantsBrowser) {
    recommendedToolIds.push(
      ...matchRecommendedToolIds(bindingCatalog.mcp_tools, [
        "browser_open_tab",
        "browser_click",
        "browser_type",
        "research",
        "search",
      ]),
    )
    recommendedSkillIds.push(
      ...matchRecommendedSkillIds(bindingCatalog.guidance_skills, [
        "official.skills.crawler",
      ]),
    )
  }

  if (wantsDesign) {
    recommendedToolIds.push(
      ...matchRecommendedToolIds(bindingCatalog.mcp_tools, [
        "image",
        "generate image",
        "image.generate",
      ]),
    )
  }

  return {
    recommendedToolIds: dedupe(recommendedToolIds),
    recommendedSkillIds: dedupe(recommendedSkillIds),
  }
}

// 鈹€鈹€ Draft builders 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export function createEmptyDraft(): TaskAgentDraft {
  return {
    name: "",
    description: "",
    task_prompt: "",
    invocation_kind: "chat",
    preferred_for_image_generation: false,
    model: "",
    provider_model_id: "",
    image_config: createEmptyTaskAgentImageConfigDraft(),
    voice_config: createEmptyTaskAgentVoiceConfigDraft(),
    model_config_json: "",
    callable_mcp_tool_ids: [],
    guidance_skill_ids: [],
    bound_asset_id: "",
    source_kind: "",
    source_path: "",
    tags_input: "",
    discoverable: true,
    is_enabled: true,
  }
}

export function extractModelValue(
  modelConfig?: Record<string, unknown> | null,
): string {
  const candidate = modelConfig?.model ?? modelConfig?.model_name
  return typeof candidate === "string" ? candidate : ""
}

export function extractProviderModelId(
  modelConfig?: Record<string, unknown> | null,
): string {
  return typeof modelConfig?.provider_model_id === "string"
    ? modelConfig.provider_model_id
    : ""
}

export function buildDraftFromProfile(
  profile: CustomTaskAgentProfile,
): TaskAgentDraft {
  const isImageAgent = profile.invocation_kind === "image_generation"
  const imageConfig = buildTaskAgentImageConfigDraft(
    profile.model_config ?? undefined,
  )
  const voiceConfig = buildTaskAgentVoiceConfigDraft(
    profile.model_config ?? undefined,
  )
  return {
    name: profile.name,
    description: profile.description ?? "",
    task_prompt: isImageAgent ? "" : profile.task_prompt,
    invocation_kind: profile.invocation_kind,
    preferred_for_image_generation: profile.preferred_for_image_generation,
    model: extractModelValue(profile.model_config ?? undefined),
    provider_model_id: extractProviderModelId(profile.model_config ?? undefined),
    image_config: isImageAgent
      ? { ...imageConfig, image_url: "" }
      : imageConfig,
    voice_config: voiceConfig,
    model_config_json: profile.model_config
      ? JSON.stringify(
          isImageAgent
            ? stripPersistedImageAgentRuntimeFields(profile.model_config)
            : profile.model_config,
          null,
          2,
        )
      : "",
    callable_mcp_tool_ids: [...profile.callable_mcp_tool_ids],
    guidance_skill_ids: [...profile.guidance_skill_ids],
    bound_asset_id: profile.bound_asset_id ?? "",
    source_kind: profile.source_kind ?? "",
    source_path: profile.source_path ?? "",
    tags_input: profile.tags.join(", "),
    discoverable: profile.discoverable,
    is_enabled: profile.is_enabled,
  }
}

// 鈹€鈹€ Parsing & formatting 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export function parseTagsInput(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function stripPersistedImageAgentRuntimeFields(
  modelConfig?: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!modelConfig) return null
  const next = { ...modelConfig }
  const imageGeneration =
    next.image_generation &&
    typeof next.image_generation === "object" &&
    !Array.isArray(next.image_generation)
      ? { ...(next.image_generation as Record<string, unknown>) }
      : null

  if (!imageGeneration) return next

  delete imageGeneration.image_url

  if (Object.keys(imageGeneration).length > 0) {
    next.image_generation = imageGeneration
  } else {
    delete next.image_generation
  }

  return next
}

function canonicalizeTaskAgentComparisonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeTaskAgentComparisonValue(item))
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalizeTaskAgentComparisonValue(item)]),
    )
  }
  return value
}

export function stableSerializeTaskAgentComparison(value: unknown): string {
  return JSON.stringify(canonicalizeTaskAgentComparisonValue(value))
}

export function normalizePreviewNumber(
  value: string,
  parser: (next: string) => number,
): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = parser(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

// 鈹€鈹€ Styling helpers 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export function statusToneClass(status: string): string {
  switch (status) {
    case "healthy":
      return "border-emerald-500/20 bg-emerald-500/8 text-emerald-400"
    case "starting":
    case "pending":
    case "updating":
      return "border-amber-500/20 bg-amber-500/8 text-amber-300"
    case "degraded":
      return "border-orange-500/20 bg-orange-500/8 text-orange-300"
    case "error":
    case "crashed":
    case "orphaned":
      return "border-red-500/20 bg-red-500/8 text-red-400"
    default:
      return "border-white/8 bg-white/4 text-[var(--muted)]"
  }
}

// 鈹€鈹€ Sorting helpers 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export function bindingStatusRank(status: string): number {
  switch (status) {
    case "healthy":
      return 0
    case "starting":
    case "pending":
    case "updating":
      return 1
    case "degraded":
      return 2
    case "stopped":
      return 3
    case "error":
    case "crashed":
    case "orphaned":
      return 4
    default:
      return 5
  }
}

export function compareBindingText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: "base" })
}

// 鈹€鈹€ Model select helpers 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export function buildTaskAgentModelOptionValue(
  instanceId: string,
  modelValue: string,
): string {
  return `${instanceId}::${modelValue}`
}

// 鈹€鈹€ Navigation guard 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export function resolveSameOriginNavigationHref(
  anchor: HTMLAnchorElement,
): string | null {
  const href = anchor.getAttribute("href")
  if (!href || href.startsWith("#")) return null
  if (anchor.target && anchor.target !== "_self") return null
  if (anchor.hasAttribute("download")) return null
  if (/^(mailto:|tel:|javascript:)/i.test(href)) return null

  const destination = new URL(anchor.href, window.location.href)
  const current = new URL(window.location.href)
  if (destination.origin !== current.origin) return null

  const nextPath = `${destination.pathname}${destination.search}${destination.hash}`
  const currentPath = `${current.pathname}${current.search}${current.hash}`
  if (nextPath === currentPath) return null

  return nextPath
}


