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

// ── Constants ──────────────────────────────────────────────────────────

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

// ── Draft builders ─────────────────────────────────────────────────────

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
    tags_input: profile.tags.join(", "),
    discoverable: profile.discoverable,
    is_enabled: profile.is_enabled,
  }
}

// ── Parsing & formatting ───────────────────────────────────────────────

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

// ── Styling helpers ────────────────────────────────────────────────────

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

// ── Sorting helpers ────────────────────────────────────────────────────

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

// ── Model select helpers ───────────────────────────────────────────────

export function buildTaskAgentModelOptionValue(
  instanceId: string,
  modelValue: string,
): string {
  return `${instanceId}::${modelValue}`
}

// ── Navigation guard ───────────────────────────────────────────────────

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
