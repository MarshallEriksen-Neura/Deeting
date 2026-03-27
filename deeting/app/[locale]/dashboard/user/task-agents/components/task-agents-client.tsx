"use client"

import * as React from "react"
import useSWR from "swr"
import { useLocale, useTranslations } from "next-intl"
import { useRouter } from "next/navigation"
import {
  Bot,
  CheckCircle2,
  Plus,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"

import {
  createCustomTaskAgent,
  deleteCustomTaskAgent,
  getCustomTaskAgentBindingCatalog,
  listCustomTaskAgents,
  previewCustomTaskAgent,
  reindexCustomTaskAgents,
  supportsLocalCustomTaskAgents,
  updateCustomTaskAgent,
  type CustomTaskAgentBindingCatalog,
  type CustomTaskAgentInvocationKind,
  type CustomTaskAgentPreviewResponse,
  type CustomTaskAgentProfile,
  type UpsertCustomTaskAgentPayload,
} from "@/lib/api/custom-task-agents"
import { useChatService } from "@/hooks/use-chat-service"
import { cn } from "@/lib/utils"
import {
  applyTaskAgentImageConfigToModelConfig,
  buildTaskAgentImageConfigDraft,
  createEmptyTaskAgentImageConfigDraft,
  parseTaskAgentImageExtraParamsJson,
  type TaskAgentImageConfigDraft,
} from "./task-agent-image-config"
import {
  applyTaskAgentVoiceConfigToModelConfig,
  buildTaskAgentVoiceConfigDraft,
  createEmptyTaskAgentVoiceConfigDraft,
  parseTaskAgentVoiceExtraParamsJson,
  type TaskAgentVoiceConfigDraft,
} from "./task-agent-voice-config"
import { ChatTaskAgentEditor } from "./chat-task-agent-editor"
import { ImageTaskAgentEditor } from "./image-task-agent-editor"
import { TaskAgentPreviewPanel } from "./task-agent-preview-panel"
import { VoiceTaskAgentEditor } from "./voice-task-agent-editor"
import type {
  PreviewDraft,
  TaskAgentDraft,
  TaskAgentModelOption,
} from "./task-agent-editor-types"
import { PageHeader } from "@/components/ui/page-header/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  GlassCard,
  GlassCardContent,
  GlassCardDescription,
  GlassCardHeader,
  GlassCardTitle,
} from "@/components/ui/glass-card"
import { Skeleton } from "@/components/ui/skeleton"
import { TaskAgentTypeStarter } from "./task-agent-type-starter"

const NEW_AGENT_ID = "__new_custom_task_agent__"
const DEFAULT_TASK_AGENT_MODEL_VALUE = "__task_agent_model_default__"
const INTERNAL_IMAGE_AGENT_TASK_PROMPT =
  "Generate images from the user's current chat request and attachments."
const INTERNAL_TTS_AGENT_TASK_PROMPT =
  "Generate speech audio from the user's current chat request."


const defaultPreviewDraft: PreviewDraft = {
  message: "",
  temperature: "",
  max_tokens: "",
  max_rounds: "",
}

function createEmptyDraft(): TaskAgentDraft {
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
    tags_input: "",
    discoverable: true,
    is_enabled: true,
  }
}

function extractModelValue(modelConfig?: Record<string, unknown> | null): string {
  const candidate = modelConfig?.model ?? modelConfig?.model_name
  return typeof candidate === "string" ? candidate : ""
}

function extractProviderModelId(
  modelConfig?: Record<string, unknown> | null,
): string {
  return typeof modelConfig?.provider_model_id === "string"
    ? modelConfig.provider_model_id
    : ""
}

function buildDraftFromProfile(profile: CustomTaskAgentProfile): TaskAgentDraft {
  const isImageAgent = profile.invocation_kind === "image_generation"
  const imageConfig = buildTaskAgentImageConfigDraft(profile.model_config ?? undefined)
  const voiceConfig = buildTaskAgentVoiceConfigDraft(profile.model_config ?? undefined)
  return {
    name: profile.name,
    description: profile.description ?? "",
    task_prompt: isImageAgent ? "" : profile.task_prompt,
    invocation_kind: profile.invocation_kind,
    preferred_for_image_generation: profile.preferred_for_image_generation,
    model: extractModelValue(profile.model_config ?? undefined),
    provider_model_id: extractProviderModelId(profile.model_config ?? undefined),
    image_config: isImageAgent
      ? {
          ...imageConfig,
          image_url: "",
        }
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
    tags_input: profile.tags.join(", "),
    discoverable: profile.discoverable,
    is_enabled: profile.is_enabled,
  }
}

function parseTagsInput(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function stripPersistedImageAgentRuntimeFields(
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

  if (!imageGeneration) {
    return next
  }

  delete imageGeneration.image_url

  if (Object.keys(imageGeneration).length > 0) {
    next.image_generation = imageGeneration
  } else {
    delete next.image_generation
  }

  return next
}

function statusToneClass(status: string): string {
  switch (status) {
    case "healthy":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
    case "starting":
    case "pending":
    case "updating":
      return "border-amber-500/30 bg-amber-500/10 text-amber-200"
    case "degraded":
      return "border-orange-500/30 bg-orange-500/10 text-orange-200"
    case "error":
    case "crashed":
    case "orphaned":
      return "border-red-500/30 bg-red-500/10 text-red-300"
    default:
      return "border-white/10 bg-white/5 text-[var(--muted)]"
  }
}

function normalizePreviewNumber(
  value: string,
  parser: (next: string) => number,
): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = parser(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

function bindingStatusRank(status: string): number {
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

function compareBindingText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: "base" })
}

function buildTaskAgentModelOptionValue(instanceId: string, modelValue: string): string {
  return `${instanceId}::${modelValue}`
}

function resolveSameOriginNavigationHref(anchor: HTMLAnchorElement): string | null {
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

const AgentListItem = React.memo(function AgentListItem({
  agent,
  isSelected,
  updatedLabel,
  invocationLabel,
  preferredImageLabel,
  enabledLabel,
  disabledLabel,
  discoverableLabel,
  hiddenLabel,
  onSelect,
}: {
  agent: CustomTaskAgentProfile
  isSelected: boolean
  updatedLabel: string
  invocationLabel: string
  preferredImageLabel: string
  enabledLabel: string
  disabledLabel: string
  discoverableLabel: string
  hiddenLabel: string
  onSelect: (agentId: string) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(agent.id)}
      className={cn(
        "w-full rounded-2xl border p-4 text-left transition-all duration-200",
        "hover:border-[var(--primary)]/30 hover:bg-white/[0.04]",
        isSelected
          ? "border-[var(--primary)]/40 bg-[var(--primary)]/10 shadow-[0_0_0_1px_rgba(124,109,255,0.15)]"
          : "border-white/10 bg-white/[0.03]",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-[var(--foreground)]">
              {agent.name}
            </span>
            <Badge variant="secondary" className="capitalize">
              {invocationLabel}
            </Badge>
            {agent.preferred_for_image_generation ? (
              <Badge className="border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-200">
                {preferredImageLabel}
              </Badge>
            ) : null}
          </div>
          <p className="line-clamp-2 text-sm text-[var(--muted)]">
            {agent.description?.trim() || "—"}
          </p>
        </div>
        <div className="shrink-0">
          <span
            className={cn(
              "inline-flex rounded-full border px-2 py-1 text-[11px] font-medium",
              agent.is_enabled
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : "border-white/10 bg-white/5 text-[var(--muted)]",
            )}
          >
            {agent.is_enabled ? enabledLabel : disabledLabel}
          </span>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "inline-flex rounded-full border px-2 py-1 text-[11px]",
            agent.discoverable
              ? "border-blue-500/30 bg-blue-500/10 text-blue-300"
              : "border-white/10 bg-white/5 text-[var(--muted)]",
          )}
        >
          {agent.discoverable ? discoverableLabel : hiddenLabel}
        </span>
        {agent.tags.slice(0, 3).map((tag) => (
          <span
            key={tag}
            className="inline-flex rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-[var(--muted)]"
          >
            {tag}
          </span>
        ))}
      </div>

      <p className="mt-3 text-xs text-[var(--muted)]">{updatedLabel}</p>
    </button>
  )
})

export function TaskAgentsClient() {
  const t = useTranslations("task-agents")
  const locale = useLocale()
  const router = useRouter()
  const [desktopSupport, setDesktopSupport] = React.useState<boolean | null>(null)
  const isDesktop = desktopSupport === true
  const deferredLocale = React.useDeferredValue(locale)
  const [searchQuery, setSearchQuery] = React.useState("")
  const deferredSearchQuery = React.useDeferredValue(searchQuery)
  const [toolQuery, setToolQuery] = React.useState("")
  const [skillQuery, setSkillQuery] = React.useState("")
  const deferredToolQuery = React.useDeferredValue(toolQuery)
  const deferredSkillQuery = React.useDeferredValue(skillQuery)
  const [showSelectedToolsOnly, setShowSelectedToolsOnly] = React.useState(false)
  const [showSelectedSkillsOnly, setShowSelectedSkillsOnly] = React.useState(false)
  const [kindFilter, setKindFilter] = React.useState("all")
  const [statusFilter, setStatusFilter] = React.useState("all")
  const [selectedAgentId, setSelectedAgentId] = React.useState<string | null>(null)
  const [createFlowStep, setCreateFlowStep] = React.useState<"starter" | "editor">(
    "editor",
  )
  const [draft, setDraft] = React.useState<TaskAgentDraft>(createEmptyDraft)
  const [previewDraft, setPreviewDraft] =
    React.useState<PreviewDraft>(defaultPreviewDraft)
  const [previewResult, setPreviewResult] =
    React.useState<CustomTaskAgentPreviewResponse | null>(null)
  const [previewError, setPreviewError] = React.useState<string | null>(null)
  const [isSaving, setIsSaving] = React.useState(false)
  const [isPreviewing, setIsPreviewing] = React.useState(false)
  const [isReindexing, setIsReindexing] = React.useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)
  const [discardDialogOpen, setDiscardDialogOpen] = React.useState(false)
  const pendingNavigationRef = React.useRef<(() => void) | null>(null)
  const hydratedSelectionRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    setDesktopSupport(supportsLocalCustomTaskAgents())
  }, [])

  const {
    data: agents = [],
    error: agentsError,
    isLoading: agentsLoading,
    mutate: mutateAgents,
  } = useSWR<CustomTaskAgentProfile[], Error>(
    isDesktop ? "local-custom-task-agents" : null,
    () => listCustomTaskAgents(),
    {
      revalidateOnFocus: false,
      keepPreviousData: true,
    },
  )

  const {
    data: bindingCatalog = {
      mcp_tools: [],
      guidance_skills: [],
      skill_actions: [],
    },
    isLoading: bindingsLoading,
  } = useSWR<CustomTaskAgentBindingCatalog, Error>(
    isDesktop ? "local-custom-task-agent-binding-catalog" : null,
    () => getCustomTaskAgentBindingCatalog(),
    {
      revalidateOnFocus: false,
      keepPreviousData: true,
    },
  )

  const {
    modelGroups,
    isLoadingModels,
  } = useChatService({
    enabled: isDesktop,
    fetchAssistants: false,
    modelCapability:
      draft.invocation_kind === "image_generation"
        ? "image_generation"
        : draft.invocation_kind === "text_to_speech"
          ? "text_to_speech"
          : "chat",
  })

  React.useEffect(() => {
    if (!isDesktop) return
    if (!selectedAgentId) {
      setSelectedAgentId(agents[0]?.id ?? NEW_AGENT_ID)
      setCreateFlowStep(agents[0] ? "editor" : "starter")
      return
    }
    if (
      selectedAgentId !== NEW_AGENT_ID &&
      !agents.some((agent) => agent.id === selectedAgentId)
    ) {
      setSelectedAgentId(agents[0]?.id ?? NEW_AGENT_ID)
      setCreateFlowStep(agents[0] ? "editor" : "starter")
    }
  }, [agents, isDesktop, selectedAgentId])

  React.useEffect(() => {
    if (!selectedAgentId) return
    if (selectedAgentId === NEW_AGENT_ID) {
      if (hydratedSelectionRef.current !== NEW_AGENT_ID) {
        hydratedSelectionRef.current = NEW_AGENT_ID
        setDraft(createEmptyDraft())
        setPreviewDraft(defaultPreviewDraft)
        setPreviewResult(null)
        setPreviewError(null)
      }
      return
    }

    const next = agents.find((agent) => agent.id === selectedAgentId)
    if (!next) return

    const hydrationKey = `${selectedAgentId}:${next.updated_at}`
    if (hydratedSelectionRef.current !== hydrationKey) {
      hydratedSelectionRef.current = hydrationKey
      setDraft(buildDraftFromProfile(next))
      setPreviewDraft(defaultPreviewDraft)
      setPreviewResult(null)
      setPreviewError(null)
    }
  }, [agents, selectedAgentId])

  const selectedAgent = React.useMemo(
    () =>
      selectedAgentId && selectedAgentId !== NEW_AGENT_ID
        ? agents.find((agent) => agent.id === selectedAgentId) ?? null
        : null,
    [agents, selectedAgentId],
  )

  const isStarterState =
    selectedAgentId === NEW_AGENT_ID && createFlowStep === "starter"

  const isImageWorkspace =
    !isStarterState &&
    (selectedAgent?.invocation_kind ?? draft.invocation_kind) ===
      "image_generation"
  const isVoiceWorkspace =
    !isStarterState &&
    (selectedAgent?.invocation_kind ?? draft.invocation_kind) ===
      "text_to_speech"

  const showBindingsWorkspace = !isStarterState && !isImageWorkspace && !isVoiceWorkspace

  const dateFormatter = React.useMemo(
    () =>
      new Intl.DateTimeFormat(deferredLocale, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
    [deferredLocale],
  )

  const normalizedQuery = React.useMemo(
    () => deferredSearchQuery.trim().toLowerCase(),
    [deferredSearchQuery],
  )

  const filteredAgents = React.useMemo(() => {
    return agents.filter((agent) => {
      if (kindFilter !== "all" && agent.invocation_kind !== kindFilter) {
        return false
      }
      if (statusFilter === "enabled" && !agent.is_enabled) {
        return false
      }
      if (statusFilter === "disabled" && agent.is_enabled) {
        return false
      }
      if (!normalizedQuery) return true

      const haystack = [
        agent.name,
        agent.description ?? "",
        agent.task_prompt,
        ...agent.tags,
      ]
        .join(" ")
        .toLowerCase()

      return haystack.includes(normalizedQuery)
    })
  }, [agents, kindFilter, normalizedQuery, statusFilter])

  const groupedAgents = React.useMemo(
    () => ({
      chat: filteredAgents.filter((agent) => agent.invocation_kind === "chat"),
      image: filteredAgents.filter(
        (agent) => agent.invocation_kind === "image_generation",
      ),
      voice: filteredAgents.filter(
        (agent) => agent.invocation_kind === "text_to_speech",
      ),
    }),
    [filteredAgents],
  )

  const filteredBindingTools = React.useMemo(() => {
    const normalizedToolQuery = deferredToolQuery.trim().toLowerCase()
    return bindingCatalog.mcp_tools
      .filter((tool: (typeof bindingCatalog.mcp_tools)[number]) => {
      if (
        showSelectedToolsOnly &&
        !draft.callable_mcp_tool_ids.includes(tool.id)
      ) {
        return false
      }

      if (!normalizedToolQuery) return true

      const haystack = [tool.name, tool.description, tool.id, tool.status]
        .join(" ")
        .toLowerCase()

        return haystack.includes(normalizedToolQuery)
      })
      .toSorted(
        (
          left: (typeof bindingCatalog.mcp_tools)[number],
          right: (typeof bindingCatalog.mcp_tools)[number],
        ) => {
        const leftSelected = draft.callable_mcp_tool_ids.includes(left.id)
        const rightSelected = draft.callable_mcp_tool_ids.includes(right.id)
        if (leftSelected !== rightSelected) {
          return leftSelected ? -1 : 1
        }

        const rankDelta =
          bindingStatusRank(left.status) - bindingStatusRank(right.status)
        if (rankDelta !== 0) return rankDelta

        return compareBindingText(left.name, right.name)
      })
  }, [
    bindingCatalog.mcp_tools,
    deferredToolQuery,
    draft.callable_mcp_tool_ids,
    showSelectedToolsOnly,
  ])

  const filteredBindingSkills = React.useMemo(() => {
    const normalizedSkillQuery = deferredSkillQuery.trim().toLowerCase()
    return bindingCatalog.guidance_skills
      .filter((skill: (typeof bindingCatalog.guidance_skills)[number]) => {
      if (
        showSelectedSkillsOnly &&
        !draft.guidance_skill_ids.includes(skill.skill_id)
      ) {
        return false
      }

      if (!normalizedSkillQuery) return true

      const haystack = [
        skill.skill_id,
        skill.installed_version ?? "",
        skill.runtime ?? "",
      ]
        .join(" ")
        .toLowerCase()

        return haystack.includes(normalizedSkillQuery)
      })
      .toSorted(
        (
          left: (typeof bindingCatalog.guidance_skills)[number],
          right: (typeof bindingCatalog.guidance_skills)[number],
        ) => {
        const leftSelected = draft.guidance_skill_ids.includes(left.skill_id)
        const rightSelected = draft.guidance_skill_ids.includes(right.skill_id)
        if (leftSelected !== rightSelected) {
          return leftSelected ? -1 : 1
        }

        if (left.is_enabled !== right.is_enabled) {
          return left.is_enabled ? -1 : 1
        }

        return compareBindingText(left.skill_id, right.skill_id)
      })
  }, [
    bindingCatalog.guidance_skills,
    deferredSkillQuery,
    draft.guidance_skill_ids,
    showSelectedSkillsOnly,
  ])

  const taskAgentModelOptions = React.useMemo<TaskAgentModelOption[]>(
    () =>
      modelGroups.flatMap((group) =>
        group.models.map((model) => ({
          value: buildTaskAgentModelOptionValue(
            group.instance_id,
            model.provider_model_id ?? model.id,
          ),
          modelId: model.id,
          providerModelId: model.provider_model_id ?? "",
        })),
      ),
    [modelGroups],
  )

  const selectedTaskAgentModelOption = React.useMemo(() => {
    const trimmedProviderModelId = draft.provider_model_id.trim()
    if (trimmedProviderModelId) {
      const matchedByProviderModelId = taskAgentModelOptions.find(
        (option) => option.providerModelId === trimmedProviderModelId,
      )
      if (matchedByProviderModelId) {
        return matchedByProviderModelId
      }
    }

    const trimmedModel = draft.model.trim()
    if (!trimmedModel) {
      return null
    }

    return (
      taskAgentModelOptions.find((option) => option.modelId === trimmedModel) ?? null
    )
  }, [draft.model, draft.provider_model_id, taskAgentModelOptions])

  const unknownTaskAgentModelLabel = React.useMemo(() => {
    const values = [draft.model.trim(), draft.provider_model_id.trim()].filter(Boolean)
    return values.join(" / ")
  }, [draft.model, draft.provider_model_id])

  const unknownTaskAgentModelValue =
    selectedTaskAgentModelOption || !unknownTaskAgentModelLabel
      ? null
      : `__task_agent_model_custom__:${unknownTaskAgentModelLabel}`

  const taskAgentModelSelectValue =
    selectedTaskAgentModelOption?.value ??
    unknownTaskAgentModelValue ??
    DEFAULT_TASK_AGENT_MODEL_VALUE

  const stats = React.useMemo(
    () => [
      {
        key: "total",
        label: t("stats.total"),
        value: agents.length,
        icon: Bot,
      },
      {
        key: "enabled",
        label: t("stats.enabled"),
        value: agents.filter((agent) => agent.is_enabled).length,
        icon: CheckCircle2,
      },
      {
        key: "discoverable",
        label: t("stats.discoverable"),
        value: agents.filter((agent) => agent.discoverable).length,
        icon: Sparkles,
      },
      {
        key: "updated",
        label: t("stats.updated"),
        value: agents[0]?.updated_at
          ? dateFormatter.format(new Date(agents[0].updated_at))
          : "—",
        icon: RefreshCw,
      },
    ],
    [agents, dateFormatter, t],
  )

  const parsedModelConfig = React.useMemo(() => {
    const trimmed = draft.model_config_json.trim()
    if (!trimmed) {
      return {
        value: {} as Record<string, unknown>,
        error: null as string | null,
      }
    }

    try {
      const parsed = JSON.parse(trimmed)
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
        return {
          value: {} as Record<string, unknown>,
          error: t("editor.modelConfig.invalidJson"),
        }
      }
      return {
        value: parsed as Record<string, unknown>,
        error: null as string | null,
      }
    } catch {
      return {
        value: {} as Record<string, unknown>,
        error: t("editor.modelConfig.invalidJson"),
      }
    }
  }, [draft.model_config_json, t])

  const parsedImageExtraParams = React.useMemo(() => {
    const parsed = parseTaskAgentImageExtraParamsJson(
      draft.image_config.extra_params_json,
    )
    return {
      value: parsed.value,
      error: parsed.error
        ? t("editor.imageConfig.invalidExtraParamsJson")
        : null,
    }
  }, [draft.image_config.extra_params_json, t])

  const parsedVoiceExtraParams = React.useMemo(() => {
    const parsed = parseTaskAgentVoiceExtraParamsJson(
      draft.voice_config.extra_params_json,
    )
    return {
      value: parsed.value,
      error: parsed.error
        ? t("editor.voiceConfig.invalidExtraParamsJson")
        : null,
    }
  }, [draft.voice_config.extra_params_json, t])

  const draftPayload = React.useMemo<UpsertCustomTaskAgentPayload>(() => {
    let modelConfig = { ...parsedModelConfig.value }
    const trimmedModel = draft.model.trim()
    const trimmedProviderModelId = draft.provider_model_id.trim()
    const isImageAgent = draft.invocation_kind === "image_generation"
    const isVoiceAgent = draft.invocation_kind === "text_to_speech"

    if (trimmedModel) {
      modelConfig.model = trimmedModel
      delete modelConfig.model_name
    } else {
      delete modelConfig.model
      delete modelConfig.model_name
    }

    if (trimmedProviderModelId) {
      modelConfig.provider_model_id = trimmedProviderModelId
    } else {
      delete modelConfig.provider_model_id
    }

    if (isImageAgent) {
      modelConfig = applyTaskAgentImageConfigToModelConfig(
        modelConfig,
        draft.image_config,
        parsedImageExtraParams.value,
      )
      modelConfig = stripPersistedImageAgentRuntimeFields(modelConfig) ?? {}
      delete modelConfig.text_to_speech
    } else if (isVoiceAgent) {
      modelConfig = applyTaskAgentVoiceConfigToModelConfig(
        modelConfig,
        draft.voice_config,
        parsedVoiceExtraParams.value,
      )
      delete modelConfig.image_generation
    } else {
      delete modelConfig.image_generation
      delete modelConfig.text_to_speech
    }

    const normalizedDescription = draft.description.trim()
    const normalizedTags = parseTagsInput(draft.tags_input)

    return {
      name: draft.name.trim(),
      description: normalizedDescription || null,
      task_prompt: isImageAgent
        ? INTERNAL_IMAGE_AGENT_TASK_PROMPT
        : isVoiceAgent
          ? INTERNAL_TTS_AGENT_TASK_PROMPT
        : draft.task_prompt.trim(),
      invocation_kind: draft.invocation_kind,
      preferred_for_image_generation: draft.preferred_for_image_generation,
      model_config: Object.keys(modelConfig).length > 0 ? modelConfig : null,
      callable_mcp_tool_ids: [...draft.callable_mcp_tool_ids],
      guidance_skill_ids: [...draft.guidance_skill_ids],
      tags: normalizedTags,
      discoverable: draft.discoverable,
      is_enabled: draft.is_enabled,
    }
  }, [
    draft,
    parsedImageExtraParams.value,
    parsedModelConfig.value,
    parsedVoiceExtraParams.value,
  ])

  const hasImageConfigValues = React.useMemo(
    () =>
      Object.entries(draft.image_config).some(([key, value]) => {
        if (key === "image_url") return false
        return typeof value === "string" && value.trim().length > 0
      }),
    [draft.image_config],
  )

  const hasVoiceConfigValues = React.useMemo(
    () =>
      Object.values(draft.voice_config).some(
        (value) => typeof value === "string" && value.trim().length > 0,
      ),
    [draft.voice_config],
  )

  const comparableSelectedPayload = React.useMemo(() => {
    if (!selectedAgent) return null
    const isImageAgent = selectedAgent.invocation_kind === "image_generation"
    const isVoiceAgent = selectedAgent.invocation_kind === "text_to_speech"
    return {
      name: selectedAgent.name.trim(),
      description: selectedAgent.description?.trim() || null,
      task_prompt: isImageAgent
        ? INTERNAL_IMAGE_AGENT_TASK_PROMPT
        : isVoiceAgent
          ? INTERNAL_TTS_AGENT_TASK_PROMPT
        : selectedAgent.task_prompt.trim(),
      invocation_kind: selectedAgent.invocation_kind,
      preferred_for_image_generation: selectedAgent.preferred_for_image_generation,
      model_config:
        isImageAgent
          ? stripPersistedImageAgentRuntimeFields(selectedAgent.model_config ?? null)
          : isVoiceAgent
            ? selectedAgent.model_config ?? null
            : (selectedAgent.model_config ?? null),
      callable_mcp_tool_ids: selectedAgent.callable_mcp_tool_ids,
      guidance_skill_ids: selectedAgent.guidance_skill_ids,
      tags: selectedAgent.tags,
      discoverable: selectedAgent.discoverable,
      is_enabled: selectedAgent.is_enabled,
    }
  }, [selectedAgent])

  const hasUnsavedChanges = React.useMemo(() => {
    if (isStarterState) return false

    if (selectedAgentId === NEW_AGENT_ID) {
      const isImageAgent = draft.invocation_kind === "image_generation"
      const isVoiceAgent = draft.invocation_kind === "text_to_speech"
      return Boolean(
        draft.name.trim() ||
          draft.description.trim() ||
          (!isImageAgent && !isVoiceAgent && draft.task_prompt.trim()) ||
          draft.model.trim() ||
          draft.provider_model_id.trim() ||
          hasImageConfigValues ||
          hasVoiceConfigValues ||
          draft.model_config_json.trim() ||
          draft.callable_mcp_tool_ids.length ||
          draft.guidance_skill_ids.length ||
          parseTagsInput(draft.tags_input).length ||
          draft.preferred_for_image_generation !== false ||
          draft.discoverable !== true ||
          draft.is_enabled !== true,
      )
    }

    if (!comparableSelectedPayload) return false

    return (
      JSON.stringify(draftPayload) !== JSON.stringify(comparableSelectedPayload)
    )
  }, [
    comparableSelectedPayload,
    draft,
    draftPayload,
    hasImageConfigValues,
    hasVoiceConfigValues,
    isStarterState,
    selectedAgentId,
  ])

  const saveDisabled =
    isSaving ||
    Boolean(parsedModelConfig.error) ||
    Boolean(parsedImageExtraParams.error) ||
    Boolean(parsedVoiceExtraParams.error) ||
    !draftPayload.name ||
    !(draft.invocation_kind === "image_generation" || draft.invocation_kind === "text_to_speech") &&
      !draftPayload.task_prompt ||
    !hasUnsavedChanges

  const requestDiscardOrProceed = React.useCallback(
    (action: () => void) => {
      if (!hasUnsavedChanges) {
        action()
        return
      }
      pendingNavigationRef.current = action
      setDiscardDialogOpen(true)
    },
    [hasUnsavedChanges],
  )

  React.useEffect(() => {
    if (!hasUnsavedChanges) return

    const handleDocumentClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      if (!(event.target instanceof Element)) return

      const anchor = event.target.closest("a[href]")
      if (!(anchor instanceof HTMLAnchorElement)) return

      const nextHref = resolveSameOriginNavigationHref(anchor)
      if (!nextHref) return

      event.preventDefault()
      requestDiscardOrProceed(() => {
        router.push(nextHref)
      })
    }

    document.addEventListener("click", handleDocumentClick, true)
    return () => {
      document.removeEventListener("click", handleDocumentClick, true)
    }
  }, [hasUnsavedChanges, requestDiscardOrProceed, router])

  const handleDiscardConfirm = React.useCallback(() => {
    setDiscardDialogOpen(false)
    pendingNavigationRef.current?.()
    pendingNavigationRef.current = null
  }, [])

  const handleDiscardCancel = React.useCallback(() => {
    setDiscardDialogOpen(false)
    pendingNavigationRef.current = null
  }, [])

  const handleSelectAgent = React.useCallback(
    (agentId: string) => {
      if (agentId === selectedAgentId) return
      requestDiscardOrProceed(() => {
        setSelectedAgentId(agentId)
        setCreateFlowStep("editor")
      })
    },
    [requestDiscardOrProceed, selectedAgentId],
  )

  const handleCreateNew = React.useCallback(() => {
    if (selectedAgentId === NEW_AGENT_ID) return
    requestDiscardOrProceed(() => {
      setSelectedAgentId(NEW_AGENT_ID)
      setCreateFlowStep("starter")
    })
  }, [requestDiscardOrProceed, selectedAgentId])

  const handleSelectNewAgentType = React.useCallback(
    (kind: CustomTaskAgentInvocationKind) => {
      setCreateFlowStep("editor")
      setDraft({
        ...createEmptyDraft(),
        invocation_kind: kind,
      })
      setPreviewDraft(defaultPreviewDraft)
      setPreviewResult(null)
      setPreviewError(null)
    },
    [],
  )

  const updateDraft = React.useCallback(
    <K extends keyof TaskAgentDraft,>(key: K, value: TaskAgentDraft[K]) => {
      setDraft((current) => ({ ...current, [key]: value }))
    },
    [],
  )

  const updateImageDraft = React.useCallback(
    <K extends keyof TaskAgentImageConfigDraft,>(
      key: K,
      value: TaskAgentImageConfigDraft[K],
    ) => {
      setDraft((current) => ({
        ...current,
        image_config: {
          ...current.image_config,
          [key]: value,
        },
      }))
    },
    [],
  )

  const updateVoiceDraft = React.useCallback(
    <K extends keyof TaskAgentDraft["voice_config"]>(
      key: K,
      value: TaskAgentDraft["voice_config"][K],
    ) => {
      setDraft((current) => ({
        ...current,
        voice_config: {
          ...current.voice_config,
          [key]: value,
        },
      }))
    },
    [],
  )

  const handleTaskAgentModelChange = React.useCallback(
    (value: string) => {
      if (value === DEFAULT_TASK_AGENT_MODEL_VALUE) {
        setDraft((current) => ({
          ...current,
          model: "",
          provider_model_id: "",
        }))
        return
      }

      const nextOption = taskAgentModelOptions.find((option) => option.value === value)
      if (!nextOption) return

      setDraft((current) => ({
        ...current,
        model: nextOption.modelId,
        provider_model_id: nextOption.providerModelId,
      }))
    },
    [taskAgentModelOptions],
  )

  const toggleBinding = React.useCallback(
    (kind: "tool" | "skill", identifier: string, checked: boolean) => {
      const targetKey =
        kind === "tool" ? "callable_mcp_tool_ids" : "guidance_skill_ids"
      setDraft((current) => {
        const nextValues = checked
          ? [...current[targetKey], identifier]
          : current[targetKey].filter((value) => value !== identifier)
        return {
          ...current,
          [targetKey]: nextValues,
        }
      })
    },
    [],
  )

  const handleSave = React.useCallback(async () => {
    if (saveDisabled) return

    try {
      setIsSaving(true)
      const saved =
        selectedAgentId === NEW_AGENT_ID
          ? await createCustomTaskAgent(draftPayload)
          : await updateCustomTaskAgent(selectedAgentId!, draftPayload)

      await mutateAgents(
        (current = []) => {
          if (selectedAgentId === NEW_AGENT_ID) {
            return [saved, ...current]
          }
          return current.map((item) => (item.id === saved.id ? saved : item))
        },
        { revalidate: false },
      )

      hydratedSelectionRef.current = `${saved.id}:${saved.updated_at}`
      setSelectedAgentId(saved.id)
      setDraft(buildDraftFromProfile(saved))
      toast.success(
        selectedAgentId === NEW_AGENT_ID
          ? t("toast.created")
          : t("toast.saved"),
      )
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("toast.saveFailed")
      toast.error(message)
    } finally {
      setIsSaving(false)
    }
  }, [draftPayload, mutateAgents, saveDisabled, selectedAgentId, t])

  const handleDelete = React.useCallback(async () => {
    if (!selectedAgent) return

    try {
      setIsSaving(true)
      await deleteCustomTaskAgent(selectedAgent.id)
      await mutateAgents(
        (current = []) => current.filter((item) => item.id !== selectedAgent.id),
        { revalidate: false },
      )
      setDeleteDialogOpen(false)
      setSelectedAgentId(null)
      hydratedSelectionRef.current = null
      toast.success(t("toast.deleted"))
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("toast.deleteFailed")
      toast.error(message)
    } finally {
      setIsSaving(false)
    }
  }, [mutateAgents, selectedAgent, t])

  const handleReindex = React.useCallback(async () => {
    try {
      setIsReindexing(true)
      await reindexCustomTaskAgents()
      toast.success(t("toast.reindexed"))
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("toast.reindexFailed")
      toast.error(message)
    } finally {
      setIsReindexing(false)
    }
  }, [t])

  const handleRunPreview = React.useCallback(async () => {
    if (!selectedAgent || !previewDraft.message.trim()) return

    try {
      setIsPreviewing(true)
      setPreviewResult(null)
      setPreviewError(null)
      const result = await previewCustomTaskAgent(selectedAgent.id, {
        message: previewDraft.message.trim(),
        temperature: normalizePreviewNumber(previewDraft.temperature, Number),
        max_tokens: normalizePreviewNumber(previewDraft.max_tokens, Number),
        max_rounds: normalizePreviewNumber(previewDraft.max_rounds, Number),
      })
      setPreviewResult(result)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("toast.previewFailed")
      setPreviewError(message)
      toast.error(message)
    } finally {
      setIsPreviewing(false)
    }
  }, [previewDraft, selectedAgent, t])

  if (desktopSupport === null) {
    return (
      <div className="space-y-8">
        <PageHeader
          title={t("title")}
          description={t("subtitle")}
          icon={Bot}
        />

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <GlassCard key={`task-agent-stats-skeleton-${index}`} className="overflow-hidden">
              <GlassCardContent className="space-y-3">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-9 w-20" />
              </GlassCardContent>
            </GlassCard>
          ))}
        </div>

        <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
          <GlassCard className="overflow-hidden">
            <GlassCardHeader className="space-y-4">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-10 w-full" />
            </GlassCardHeader>
            <GlassCardContent className="space-y-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={`task-agent-library-skeleton-${index}`}
                  className="space-y-3 rounded-2xl border border-white/10 p-4"
                >
                  <Skeleton className="h-5 w-2/3" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                </div>
              ))}
            </GlassCardContent>
          </GlassCard>

          <GlassCard className="overflow-hidden">
            <GlassCardHeader className="space-y-4">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-72 max-w-full" />
            </GlassCardHeader>
            <GlassCardContent className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-48 w-full" />
              <Skeleton className="h-24 w-full" />
            </GlassCardContent>
          </GlassCard>
        </div>
      </div>
    )
  }

  if (!isDesktop) {
    return (
      <div className="space-y-8">
        <PageHeader
          title={t("title")}
          description={t("subtitle")}
          icon={Bot}
        />
        <GlassCard>
          <GlassCardHeader>
            <GlassCardTitle>{t("unsupported.title")}</GlassCardTitle>
            <GlassCardDescription>
              {t("unsupported.description")}
            </GlassCardDescription>
          </GlassCardHeader>
        </GlassCard>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        icon={Bot}
        actions={
          <>
            <Button
              variant="outline"
              onClick={handleReindex}
              disabled={isReindexing}
            >
              <RefreshCw
                className={cn("mr-2 size-4", isReindexing && "animate-spin")}
              />
              {isReindexing ? t("actions.reindexing") : t("actions.reindex")}
            </Button>
            <Button onClick={handleCreateNew}>
              <Plus className="mr-2 size-4" />
              {t("actions.new")}
            </Button>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {stats.map((item) => {
          const Icon = item.icon
          return (
            <GlassCard key={item.key} className="overflow-hidden">
              <GlassCardContent className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-sm text-[var(--muted)]">{item.label}</p>
                  <p className="text-3xl font-semibold text-[var(--foreground)]">
                    {item.value}
                  </p>
                </div>
                <div className="rounded-2xl bg-[var(--primary)]/10 p-3 text-[var(--primary)]">
                  <Icon className="size-5" />
                </div>
              </GlassCardContent>
            </GlassCard>
          )
        })}
      </div>

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <GlassCard className="overflow-hidden">
          <GlassCardHeader className="space-y-4">
            <div className="space-y-1">
              <GlassCardTitle>{t("library.title")}</GlassCardTitle>
              <GlassCardDescription>
                {t("library.description")}
              </GlassCardDescription>
            </div>

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={t("library.searchPlaceholder")}
                className="pl-9"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Select value={kindFilter} onValueChange={setKindFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("filters.allKinds")}</SelectItem>
                  <SelectItem value="chat">{t("badges.chat")}</SelectItem>
                  <SelectItem value="image_generation">
                    {t("badges.imageGeneration")}
                  </SelectItem>
                  <SelectItem value="text_to_speech">
                    {t("badges.textToSpeech")}
                  </SelectItem>
                </SelectContent>
              </Select>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("filters.allStatuses")}
                  </SelectItem>
                  <SelectItem value="enabled">
                    {t("badges.enabled")}
                  </SelectItem>
                  <SelectItem value="disabled">
                    {t("badges.disabled")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </GlassCardHeader>

          <GlassCardContent>
            <ScrollArea className="h-[700px] pr-4">
              <div className="space-y-3">
                {selectedAgentId === NEW_AGENT_ID ? (
                  <div className="rounded-2xl border border-dashed border-[var(--primary)]/30 bg-[var(--primary)]/10 p-4">
                    <p className="font-medium text-[var(--foreground)]">
                      {isStarterState
                        ? t("starter.title")
                        : t("library.draftTitle")}
                    </p>
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      {isStarterState
                        ? t("starter.description")
                        : t("library.draftDescription")}
                    </p>
                  </div>
                ) : null}

                {agentsLoading ? (
                  Array.from({ length: 4 }).map((_, index) => (
                    <div
                      key={`agent-skeleton-${index}`}
                      className="space-y-3 rounded-2xl border border-white/10 p-4"
                    >
                      <Skeleton className="h-5 w-2/3" />
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-5/6" />
                    </div>
                  ))
                ) : filteredAgents.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center">
                    <Bot className="mx-auto size-10 text-[var(--muted)]" />
                    <p className="mt-4 font-medium text-[var(--foreground)]">
                      {t("library.emptyTitle")}
                    </p>
                    <p className="mt-2 text-sm text-[var(--muted)]">
                      {agentsError
                        ? agentsError.message
                        : t("library.emptyDescription")}
                    </p>
                  </div>
                ) : (
                  <>
                    {groupedAgents.chat.length > 0 ? (
                      <div className="space-y-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                          {t("library.sections.chat")}
                        </p>
                        {groupedAgents.chat.map((agent) => (
                          <AgentListItem
                            key={agent.id}
                            agent={agent}
                            isSelected={selectedAgentId === agent.id}
                            updatedLabel={t("library.updatedAt", {
                              value: dateFormatter.format(new Date(agent.updated_at)),
                            })}
                            invocationLabel={t("badges.chat")}
                            preferredImageLabel={t("badges.imagePreferred")}
                            enabledLabel={t("badges.enabled")}
                            disabledLabel={t("badges.disabled")}
                            discoverableLabel={t("badges.discoverable")}
                            hiddenLabel={t("badges.hidden")}
                            onSelect={handleSelectAgent}
                          />
                        ))}
                      </div>
                    ) : null}

                    {groupedAgents.image.length > 0 ? (
                      <div className="space-y-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                          {t("library.sections.image")}
                        </p>
                        {groupedAgents.image.map((agent) => (
                          <AgentListItem
                            key={agent.id}
                            agent={agent}
                            isSelected={selectedAgentId === agent.id}
                            updatedLabel={t("library.updatedAt", {
                              value: dateFormatter.format(new Date(agent.updated_at)),
                            })}
                            invocationLabel={t("badges.imageGeneration")}
                            preferredImageLabel={t("badges.imagePreferred")}
                            enabledLabel={t("badges.enabled")}
                            disabledLabel={t("badges.disabled")}
                            discoverableLabel={t("badges.discoverable")}
                            hiddenLabel={t("badges.hidden")}
                            onSelect={handleSelectAgent}
                          />
                        ))}
                      </div>
                    ) : null}

                    {groupedAgents.voice.length > 0 ? (
                      <div className="space-y-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                          {t("library.sections.voice")}
                        </p>
                        {groupedAgents.voice.map((agent) => (
                          <AgentListItem
                            key={agent.id}
                            agent={agent}
                            isSelected={selectedAgentId === agent.id}
                            updatedLabel={t("library.updatedAt", {
                              value: dateFormatter.format(new Date(agent.updated_at)),
                            })}
                            invocationLabel={t("badges.textToSpeech")}
                            preferredImageLabel={t("badges.imagePreferred")}
                            enabledLabel={t("badges.enabled")}
                            disabledLabel={t("badges.disabled")}
                            discoverableLabel={t("badges.discoverable")}
                            hiddenLabel={t("badges.hidden")}
                            onSelect={handleSelectAgent}
                          />
                        ))}
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </ScrollArea>
          </GlassCardContent>
        </GlassCard>

        <GlassCard className="overflow-hidden">
          <GlassCardHeader className="space-y-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <GlassCardTitle>
                    {selectedAgent
                      ? selectedAgent.name
                      : isStarterState
                        ? t("starter.title")
                        : isImageWorkspace
                          ? t("editor.imageWorkspace.title")
                          : isVoiceWorkspace
                            ? t("editor.voiceWorkspace.title")
                          : t("editor.chatWorkspace.title")}
                  </GlassCardTitle>
                  {selectedAgent ? (
                    <>
                      <Badge variant="secondary">
                        {selectedAgent.invocation_kind === "chat"
                          ? t("badges.chat")
                          : selectedAgent.invocation_kind === "image_generation"
                            ? t("badges.imageGeneration")
                            : t("badges.textToSpeech")}
                      </Badge>
                      <Badge
                        className={cn(
                          selectedAgent.is_enabled
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                            : "border-white/10 bg-white/5 text-[var(--muted)]",
                        )}
                      >
                        {selectedAgent.is_enabled
                          ? t("badges.enabled")
                          : t("badges.disabled")}
                      </Badge>
                    </>
                  ) : (
                    <Badge className="border-[var(--primary)]/30 bg-[var(--primary)]/10 text-[var(--primary)]">
                      {t("editor.draft")}
                    </Badge>
                  )}
                </div>
                <GlassCardDescription>
                  {selectedAgent
                    ? t("editor.updatedAt", {
                        value: dateFormatter.format(
                          new Date(selectedAgent.updated_at),
                        ),
                      })
                    : isStarterState
                      ? t("starter.description")
                      : isImageWorkspace
                        ? t("editor.imageWorkspace.description")
                        : isVoiceWorkspace
                          ? t("editor.voiceWorkspace.description")
                        : t("editor.chatWorkspace.description")}
                </GlassCardDescription>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {selectedAgent ? (
                  <Button
                    variant="outline"
                    onClick={() => setDeleteDialogOpen(true)}
                    disabled={isSaving}
                    className="text-red-300 hover:text-red-200"
                  >
                    <Trash2 className="mr-2 size-4" />
                    {t("actions.delete")}
                  </Button>
                ) : null}
                {!isStarterState ? (
                  <Button onClick={handleSave} disabled={saveDisabled}>
                    <Save className="mr-2 size-4" />
                    {isSaving
                      ? t("actions.saving")
                      : selectedAgent
                        ? t("actions.save")
                        : t("actions.create")}
                  </Button>
                ) : null}
              </div>
            </div>
          </GlassCardHeader>

          <GlassCardContent className="space-y-6">
            {isStarterState ? (
              <TaskAgentTypeStarter t={t} onSelect={handleSelectNewAgentType} />
            ) : (
            <Tabs defaultValue="config" className="space-y-6">
              <TabsList
                className={cn(
                  "grid w-full",
                  showBindingsWorkspace ? "grid-cols-4" : "grid-cols-3",
                )}
              >
                <TabsTrigger value="config">{t("tabs.config")}</TabsTrigger>
                {showBindingsWorkspace ? (
                  <TabsTrigger value="bindings">
                    {t("tabs.bindings")}
                  </TabsTrigger>
                ) : null}
                <TabsTrigger value="preview">{t("tabs.preview")}</TabsTrigger>
                <TabsTrigger value="debug">{t("tabs.debug")}</TabsTrigger>
              </TabsList>

              {isImageWorkspace ? (
                <ImageTaskAgentEditor
                  t={t}
                  draft={draft}
                  previewDraft={previewDraft}
                  draftPayload={draftPayload}
                  parsedModelConfigError={parsedModelConfig.error}
                  parsedImageExtraParamsError={parsedImageExtraParams.error}
                  taskAgentModelSelectValue={taskAgentModelSelectValue}
                  selectedTaskAgentModelOption={selectedTaskAgentModelOption}
                  unknownTaskAgentModelLabel={unknownTaskAgentModelLabel}
                  unknownTaskAgentModelValue={unknownTaskAgentModelValue}
                  isLoadingModels={isLoadingModels}
                  modelGroups={modelGroups}
                  updateDraft={updateDraft}
                  updateImageDraft={updateImageDraft}
                  handleTaskAgentModelChange={handleTaskAgentModelChange}
                />
              ) : isVoiceWorkspace ? (
                <VoiceTaskAgentEditor
                  t={t}
                  draft={draft}
                  parsedModelConfigError={parsedModelConfig.error}
                  parsedVoiceExtraParamsError={parsedVoiceExtraParams.error}
                  taskAgentModelSelectValue={taskAgentModelSelectValue}
                  selectedTaskAgentModelOption={selectedTaskAgentModelOption}
                  unknownTaskAgentModelLabel={unknownTaskAgentModelLabel}
                  unknownTaskAgentModelValue={unknownTaskAgentModelValue}
                  isLoadingModels={isLoadingModels}
                  modelGroups={modelGroups}
                  updateDraft={updateDraft}
                  updateVoiceDraft={updateVoiceDraft}
                  handleTaskAgentModelChange={handleTaskAgentModelChange}
                />
              ) : (
                <ChatTaskAgentEditor
                  t={t}
                  draft={draft}
                  previewDraft={previewDraft}
                  draftPayload={draftPayload}
                  parsedModelConfigError={parsedModelConfig.error}
                  taskAgentModelSelectValue={taskAgentModelSelectValue}
                  selectedTaskAgentModelOption={selectedTaskAgentModelOption}
                  unknownTaskAgentModelLabel={unknownTaskAgentModelLabel}
                  unknownTaskAgentModelValue={unknownTaskAgentModelValue}
                  isLoadingModels={isLoadingModels}
                  modelGroups={modelGroups}
                  bindingCatalog={bindingCatalog}
                  bindingsLoading={bindingsLoading}
                  filteredBindingTools={filteredBindingTools}
                  filteredBindingSkills={filteredBindingSkills}
                  toolQuery={toolQuery}
                  skillQuery={skillQuery}
                  showSelectedToolsOnly={showSelectedToolsOnly}
                  showSelectedSkillsOnly={showSelectedSkillsOnly}
                  updateDraft={updateDraft}
                  handleTaskAgentModelChange={handleTaskAgentModelChange}
                  setToolQuery={setToolQuery}
                  setSkillQuery={setSkillQuery}
                  setShowSelectedToolsOnly={setShowSelectedToolsOnly}
                  setShowSelectedSkillsOnly={setShowSelectedSkillsOnly}
                  toggleBinding={toggleBinding}
                />
              )}

              <TaskAgentPreviewPanel
                t={t}
                selectedAgent={selectedAgent}
                previewDraft={previewDraft}
                previewResult={previewResult}
                previewError={previewError}
                isPreviewing={isPreviewing}
                setPreviewDraft={setPreviewDraft}
                handleRunPreview={handleRunPreview}
              />

            </Tabs>
            )}
          </GlassCardContent>
        </GlassCard>
      </div>

      <AlertDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteDialog.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteDialog.description", {
                name: selectedAgent?.name ?? "—",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("deleteDialog.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-red-500 text-white hover:bg-red-600"
            >
              {t("deleteDialog.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={discardDialogOpen}
        onOpenChange={(open) => {
          if (!open) handleDiscardCancel()
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("discardDialog.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("discardDialog.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleDiscardCancel}>
              {t("discardDialog.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleDiscardConfirm}>
              {t("discardDialog.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
