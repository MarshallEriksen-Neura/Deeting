"use client"

import * as React from "react"
import useSWR from "swr"
import { useLocale } from "next-intl"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import {
  createCustomTaskAgent,
  deleteCustomTaskAgent,
  getCustomTaskAgentBindingCatalog,
  importClaudeAgents,
  listCustomTaskAgents,
  previewCustomTaskAgent,
  previewClaudeAgentImport,
  reindexCustomTaskAgents,
  supportsLocalCustomTaskAgents,
  updateCustomTaskAgent,
  type ClaudeAgentImportPreviewResponse,
  type CustomTaskAgentBindingCatalog,
  type CustomTaskAgentInvocationKind,
  type CustomTaskAgentPreviewResponse,
  type CustomTaskAgentProfile,
  type ImportClaudeAgentsResponse,
  type UpsertCustomTaskAgentPayload,
} from "@/lib/api/custom-task-agents"
import { useChatModels } from "@/hooks/use-chat-models"
import {
  applyTaskAgentImageConfigToModelConfig,
  parseTaskAgentImageExtraParamsJson,
  type TaskAgentImageConfigDraft,
} from "./task-agent-image-config"
import {
  applyTaskAgentVoiceConfigToModelConfig,
  parseTaskAgentVoiceExtraParamsJson,
} from "./task-agent-voice-config"
import type {
  PreviewDraft,
  TaskAgentDraft,
  TaskAgentModelOption,
} from "./task-agent-editor-types"
import {
  buildDraftFromProfile,
  buildTaskAgentModelOptionValue,
  createEmptyDraft,
  DEFAULT_TASK_AGENT_MODEL_VALUE,
  defaultPreviewDraft,
  INTERNAL_IMAGE_AGENT_TASK_PROMPT,
  INTERNAL_TTS_AGENT_TASK_PROMPT,
  NEW_AGENT_ID,
  normalizePreviewNumber,
  parseTagsInput,
  resolveSameOriginNavigationHref,
  stableSerializeTaskAgentComparison,
  stripPersistedImageAgentRuntimeFields,
} from "./task-agents-helpers"

type Translation = (key: string, values?: Record<string, string | number>) => string

export function useTaskAgents(t: Translation) {
  const locale = useLocale()
  const router = useRouter()
  const [desktopSupport, setDesktopSupport] = React.useState<boolean | null>(null)
  const isDesktop = desktopSupport === true
  const deferredLocale = React.useDeferredValue(locale)

  // ── Search & filter state ────────────────────────────────────────────

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

  // ── Selection & draft state ──────────────────────────────────────────

  const [selectedAgentId, setSelectedAgentId] = React.useState<string | null>(null)
  const [createFlowStep, setCreateFlowStep] = React.useState<"starter" | "editor">("editor")
  const [draft, setDraft] = React.useState<TaskAgentDraft>(createEmptyDraft)
  const [previewDraft, setPreviewDraft] = React.useState<PreviewDraft>(defaultPreviewDraft)
  const [previewResult, setPreviewResult] = React.useState<CustomTaskAgentPreviewResponse | null>(null)
  const [previewError, setPreviewError] = React.useState<string | null>(null)

  // ── Operation state ──────────────────────────────────────────────────

  const [isSaving, setIsSaving] = React.useState(false)
  const [isPreviewing, setIsPreviewing] = React.useState(false)
  const [isReindexing, setIsReindexing] = React.useState(false)
  const [isImportPreviewing, setIsImportPreviewing] = React.useState(false)
  const [isImporting, setIsImporting] = React.useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)
  const [discardDialogOpen, setDiscardDialogOpen] = React.useState(false)
  const [claudeImportPreview, setClaudeImportPreview] = React.useState<ClaudeAgentImportPreviewResponse | null>(null)
  const [claudeImportError, setClaudeImportError] = React.useState<string | null>(null)
  const pendingNavigationRef = React.useRef<(() => void) | null>(null)
  const hydratedSelectionRef = React.useRef<string | null>(null)

  // ── Desktop support detection ────────────────────────────────────────

  React.useEffect(() => {
    setDesktopSupport(supportsLocalCustomTaskAgents())
  }, [])

  // ── Data fetching ────────────────────────────────────────────────────

  const {
    data: agents = [],
    error: agentsError,
    isLoading: agentsLoading,
    mutate: mutateAgents,
  } = useSWR<CustomTaskAgentProfile[], Error>(
    isDesktop ? "local-custom-task-agents" : null,
    () => listCustomTaskAgents(),
    { revalidateOnFocus: false, keepPreviousData: true },
  )

  const {
    data: bindingCatalog = { mcp_tools: [], guidance_skills: [], skill_actions: [] },
    isLoading: bindingsLoading,
  } = useSWR<CustomTaskAgentBindingCatalog, Error>(
    isDesktop ? "local-custom-task-agent-binding-catalog" : null,
    () => getCustomTaskAgentBindingCatalog(),
    { revalidateOnFocus: false, keepPreviousData: true },
  )

  const { modelGroups, isLoadingModels } = useChatModels({
    enabled: isDesktop,
    modelCapability:
      draft.invocation_kind === "image_generation"
        ? "image_generation"
        : draft.invocation_kind === "text_to_speech"
          ? "text_to_speech"
          : "chat",
  })

  // ── Auto-select first agent ──────────────────────────────────────────

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

  // ── Hydrate draft from selected agent ────────────────────────────────

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

  // ── Computed values ──────────────────────────────────────────────────

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
    (selectedAgent?.invocation_kind ?? draft.invocation_kind) === "image_generation"
  const isVoiceWorkspace =
    !isStarterState &&
    (selectedAgent?.invocation_kind ?? draft.invocation_kind) === "text_to_speech"
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
      if (kindFilter !== "all" && agent.invocation_kind !== kindFilter) return false
      if (statusFilter === "enabled" && !agent.is_enabled) return false
      if (statusFilter === "disabled" && agent.is_enabled) return false
      if (!normalizedQuery) return true
      const haystack = [agent.name, agent.description ?? "", agent.task_prompt, ...agent.tags]
        .join(" ")
        .toLowerCase()
      return haystack.includes(normalizedQuery)
    })
  }, [agents, kindFilter, normalizedQuery, statusFilter])

  const groupedAgents = React.useMemo(
    () => ({
      chat: filteredAgents.filter((agent) => agent.invocation_kind === "chat"),
      image: filteredAgents.filter((agent) => agent.invocation_kind === "image_generation"),
      voice: filteredAgents.filter((agent) => agent.invocation_kind === "text_to_speech"),
    }),
    [filteredAgents],
  )

  const filteredBindingTools = React.useMemo(() => {
    const normalized = deferredToolQuery.trim().toLowerCase()
    return bindingCatalog.mcp_tools
      .filter((tool: (typeof bindingCatalog.mcp_tools)[number]) => {
        if (showSelectedToolsOnly && !draft.callable_mcp_tool_ids.includes(tool.id)) return false
        if (!normalized) return true
        return [tool.name, tool.description, tool.id, tool.status]
          .join(" ")
          .toLowerCase()
          .includes(normalized)
      })
      .toSorted((left: (typeof bindingCatalog.mcp_tools)[number], right: (typeof bindingCatalog.mcp_tools)[number]) => {
        const ls = draft.callable_mcp_tool_ids.includes(left.id)
        const rs = draft.callable_mcp_tool_ids.includes(right.id)
        if (ls !== rs) return ls ? -1 : 1
        const rd = (statusRank(left.status) - statusRank(right.status))
        if (rd !== 0) return rd
        return left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
      })
  }, [bindingCatalog, deferredToolQuery, draft.callable_mcp_tool_ids, showSelectedToolsOnly])

  const filteredBindingSkills = React.useMemo(() => {
    const normalized = deferredSkillQuery.trim().toLowerCase()
    return bindingCatalog.guidance_skills
      .filter((skill: (typeof bindingCatalog.guidance_skills)[number]) => {
        if (showSelectedSkillsOnly && !draft.guidance_skill_ids.includes(skill.skill_id)) return false
        if (!normalized) return true
        return [skill.skill_id, skill.installed_version ?? "", skill.runtime ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(normalized)
      })
      .toSorted((left: (typeof bindingCatalog.guidance_skills)[number], right: (typeof bindingCatalog.guidance_skills)[number]) => {
        const ls = draft.guidance_skill_ids.includes(left.skill_id)
        const rs = draft.guidance_skill_ids.includes(right.skill_id)
        if (ls !== rs) return ls ? -1 : 1
        if (left.is_enabled !== right.is_enabled) return left.is_enabled ? -1 : 1
        return left.skill_id.localeCompare(right.skill_id, undefined, { sensitivity: "base" })
      })
  }, [bindingCatalog, deferredSkillQuery, draft.guidance_skill_ids, showSelectedSkillsOnly])

  const taskAgentModelOptions = React.useMemo<TaskAgentModelOption[]>(
    () =>
      modelGroups.flatMap((group) =>
        group.models.map((model) => ({
          value: buildTaskAgentModelOptionValue(group.instance_id, model.provider_model_id ?? model.id),
          modelId: model.id,
          providerModelId: model.provider_model_id ?? "",
        })),
      ),
    [modelGroups],
  )

  const selectedTaskAgentModelOption = React.useMemo(() => {
    const trimmedPMI = draft.provider_model_id.trim()
    if (trimmedPMI) {
      const match = taskAgentModelOptions.find((o) => o.providerModelId === trimmedPMI)
      if (match) return match
    }
    const trimmedModel = draft.model.trim()
    if (!trimmedModel) return null
    return taskAgentModelOptions.find((o) => o.modelId === trimmedModel) ?? null
  }, [draft.model, draft.provider_model_id, taskAgentModelOptions])

  const unknownTaskAgentModelLabel = React.useMemo(() => {
    return [draft.model.trim(), draft.provider_model_id.trim()].filter(Boolean).join(" / ")
  }, [draft.model, draft.provider_model_id])

  const unknownTaskAgentModelValue =
    selectedTaskAgentModelOption || !unknownTaskAgentModelLabel
      ? null
      : `__task_agent_model_custom__:${unknownTaskAgentModelLabel}`

  const taskAgentModelSelectValue =
    selectedTaskAgentModelOption?.value ?? unknownTaskAgentModelValue ?? DEFAULT_TASK_AGENT_MODEL_VALUE

  // ── Parsed configs ───────────────────────────────────────────────────

  const parsedModelConfig = React.useMemo(() => {
    const trimmed = draft.model_config_json.trim()
    if (!trimmed) return { value: {} as Record<string, unknown>, error: null as string | null }
    try {
      const parsed = JSON.parse(trimmed)
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
        return { value: {} as Record<string, unknown>, error: t("editor.modelConfig.invalidJson") }
      }
      return { value: parsed as Record<string, unknown>, error: null as string | null }
    } catch {
      return { value: {} as Record<string, unknown>, error: t("editor.modelConfig.invalidJson") }
    }
  }, [draft.model_config_json, t])

  const parsedImageExtraParams = React.useMemo(() => {
    const parsed = parseTaskAgentImageExtraParamsJson(draft.image_config.extra_params_json)
    return { value: parsed.value, error: parsed.error ? t("editor.imageConfig.invalidExtraParamsJson") : null }
  }, [draft.image_config.extra_params_json, t])

  const parsedVoiceExtraParams = React.useMemo(() => {
    const parsed = parseTaskAgentVoiceExtraParamsJson(draft.voice_config.extra_params_json)
    return { value: parsed.value, error: parsed.error ? t("editor.voiceConfig.invalidExtraParamsJson") : null }
  }, [draft.voice_config.extra_params_json, t])

  // ── Draft payload ────────────────────────────────────────────────────

  const buildPayloadFromDraft = React.useCallback(
    (
      sourceDraft: TaskAgentDraft,
      options?: {
        modelConfig?: Record<string, unknown>
        imageExtraParams?: Record<string, unknown> | null
        voiceExtraParams?: Record<string, unknown> | null
      },
    ): UpsertCustomTaskAgentPayload => {
      let modelConfig = { ...(options?.modelConfig ?? {}) }
      const trimmedModel = sourceDraft.model.trim()
      const trimmedPMI = sourceDraft.provider_model_id.trim()
      const isImage = sourceDraft.invocation_kind === "image_generation"
      const isVoice = sourceDraft.invocation_kind === "text_to_speech"

      if (trimmedModel) { modelConfig.model = trimmedModel; delete modelConfig.model_name }
      else { delete modelConfig.model; delete modelConfig.model_name }

      if (trimmedPMI) modelConfig.provider_model_id = trimmedPMI
      else delete modelConfig.provider_model_id

      if (isImage) {
        modelConfig = applyTaskAgentImageConfigToModelConfig(
          modelConfig,
          sourceDraft.image_config,
          options?.imageExtraParams ?? null,
        )
        modelConfig = stripPersistedImageAgentRuntimeFields(modelConfig) ?? {}
        delete modelConfig.text_to_speech
      } else if (isVoice) {
        modelConfig = applyTaskAgentVoiceConfigToModelConfig(
          modelConfig,
          sourceDraft.voice_config,
          options?.voiceExtraParams ?? null,
        )
        delete modelConfig.image_generation
      } else {
        delete modelConfig.image_generation
        delete modelConfig.text_to_speech
      }

      return {
        name: sourceDraft.name.trim(),
        description: sourceDraft.description.trim() || null,
        task_prompt: isImage ? INTERNAL_IMAGE_AGENT_TASK_PROMPT : isVoice ? INTERNAL_TTS_AGENT_TASK_PROMPT : sourceDraft.task_prompt.trim(),
        invocation_kind: sourceDraft.invocation_kind,
        preferred_for_image_generation: sourceDraft.preferred_for_image_generation,
        model_config: Object.keys(modelConfig).length > 0 ? modelConfig : null,
        callable_mcp_tool_ids: [...sourceDraft.callable_mcp_tool_ids],
        guidance_skill_ids: [...sourceDraft.guidance_skill_ids],
        tags: parseTagsInput(sourceDraft.tags_input),
        discoverable: sourceDraft.discoverable,
        is_enabled: sourceDraft.is_enabled,
      }
    },
    [],
  )

  const draftPayload = React.useMemo<UpsertCustomTaskAgentPayload>(() => {
    return buildPayloadFromDraft(draft, {
      modelConfig: parsedModelConfig.value,
      imageExtraParams: parsedImageExtraParams.value,
      voiceExtraParams: parsedVoiceExtraParams.value,
    })
  }, [buildPayloadFromDraft, draft, parsedImageExtraParams.value, parsedModelConfig.value, parsedVoiceExtraParams.value])

  // ── Dirty tracking ──────────────────────────────────────────────────

  const hasImageConfigValues = React.useMemo(
    () => Object.entries(draft.image_config).some(([key, value]) => key !== "image_url" && typeof value === "string" && value.trim().length > 0),
    [draft.image_config],
  )

  const hasVoiceConfigValues = React.useMemo(
    () => Object.values(draft.voice_config).some((value) => typeof value === "string" && value.trim().length > 0),
    [draft.voice_config],
  )

  const comparableSelectedPayload = React.useMemo(() => {
    if (!selectedAgent) return null
    const selectedDraft = buildDraftFromProfile(selectedAgent)
    return buildPayloadFromDraft(selectedDraft, {
      modelConfig: selectedDraft.model_config_json.trim()
        ? (JSON.parse(selectedDraft.model_config_json) as Record<string, unknown>)
        : {},
      imageExtraParams: parseTaskAgentImageExtraParamsJson(
        selectedDraft.image_config.extra_params_json,
      ).value,
      voiceExtraParams: parseTaskAgentVoiceExtraParamsJson(
        selectedDraft.voice_config.extra_params_json,
      ).value,
    })
  }, [buildPayloadFromDraft, selectedAgent])

  const hasUnsavedChanges = React.useMemo(() => {
    if (isStarterState) return false
    if (selectedAgentId === NEW_AGENT_ID) {
      const isImage = draft.invocation_kind === "image_generation"
      const isVoice = draft.invocation_kind === "text_to_speech"
      return Boolean(
        draft.name.trim() || draft.description.trim() ||
        (!isImage && !isVoice && draft.task_prompt.trim()) ||
        draft.model.trim() || draft.provider_model_id.trim() ||
        hasImageConfigValues || hasVoiceConfigValues ||
        draft.model_config_json.trim() || draft.callable_mcp_tool_ids.length ||
        draft.guidance_skill_ids.length || parseTagsInput(draft.tags_input).length ||
        draft.preferred_for_image_generation !== false ||
        draft.discoverable !== true || draft.is_enabled !== true,
      )
    }
    if (!comparableSelectedPayload) return false
    return (
      stableSerializeTaskAgentComparison(draftPayload) !==
      stableSerializeTaskAgentComparison(comparableSelectedPayload)
    )
  }, [comparableSelectedPayload, draft, draftPayload, hasImageConfigValues, hasVoiceConfigValues, isStarterState, selectedAgentId])

  const saveDisabled =
    isSaving ||
    Boolean(parsedModelConfig.error) ||
    Boolean(parsedImageExtraParams.error) ||
    Boolean(parsedVoiceExtraParams.error) ||
    !draftPayload.name ||
    (!(draft.invocation_kind === "image_generation" || draft.invocation_kind === "text_to_speech") && !draftPayload.task_prompt) ||
    !hasUnsavedChanges

  // ── Stats ────────────────────────────────────────────────────────────

  const stats = React.useMemo(
    () => ({
      total: agents.length,
      enabled: agents.filter((a) => a.is_enabled).length,
      discoverable: agents.filter((a) => a.discoverable).length,
      lastUpdated: agents[0]?.updated_at ? dateFormatter.format(new Date(agents[0].updated_at)) : "—",
    }),
    [agents, dateFormatter],
  )

  // ── Handlers ─────────────────────────────────────────────────────────

  const requestDiscardOrProceed = React.useCallback(
    (action: () => void) => {
      if (!hasUnsavedChanges) { action(); return }
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
      requestDiscardOrProceed(() => router.push(nextHref))
    }
    document.addEventListener("click", handleDocumentClick, true)
    return () => document.removeEventListener("click", handleDocumentClick, true)
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
      setDraft({ ...createEmptyDraft(), invocation_kind: kind })
      setPreviewDraft(defaultPreviewDraft)
      setPreviewResult(null)
      setPreviewError(null)
    },
    [],
  )

  const updateDraft = React.useCallback(
    <K extends keyof TaskAgentDraft>(key: K, value: TaskAgentDraft[K]) => {
      setDraft((current) => ({ ...current, [key]: value }))
    },
    [],
  )

  const updateImageDraft = React.useCallback(
    <K extends keyof TaskAgentImageConfigDraft>(key: K, value: TaskAgentImageConfigDraft[K]) => {
      setDraft((current) => ({ ...current, image_config: { ...current.image_config, [key]: value } }))
    },
    [],
  )

  const updateVoiceDraft = React.useCallback(
    <K extends keyof TaskAgentDraft["voice_config"]>(key: K, value: TaskAgentDraft["voice_config"][K]) => {
      setDraft((current) => ({ ...current, voice_config: { ...current.voice_config, [key]: value } }))
    },
    [],
  )

  const handleTaskAgentModelChange = React.useCallback(
    (value: string) => {
      if (value === DEFAULT_TASK_AGENT_MODEL_VALUE) {
        setDraft((current) => ({ ...current, model: "", provider_model_id: "" }))
        return
      }
      const next = taskAgentModelOptions.find((o) => o.value === value)
      if (!next) return
      setDraft((current) => ({ ...current, model: next.modelId, provider_model_id: next.providerModelId }))
    },
    [taskAgentModelOptions],
  )

  const toggleBinding = React.useCallback(
    (kind: "tool" | "skill", identifier: string, checked: boolean) => {
      const key = kind === "tool" ? "callable_mcp_tool_ids" : "guidance_skill_ids"
      setDraft((current) => ({
        ...current,
        [key]: checked
          ? [...current[key], identifier]
          : current[key].filter((v) => v !== identifier),
      }))
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
        (current = []) =>
          selectedAgentId === NEW_AGENT_ID
            ? [saved, ...current]
            : current.map((item) => (item.id === saved.id ? saved : item)),
        { revalidate: false },
      )
      hydratedSelectionRef.current = `${saved.id}:${saved.updated_at}`
      setSelectedAgentId(saved.id)
      setDraft(buildDraftFromProfile(saved))
      toast.success(selectedAgentId === NEW_AGENT_ID ? t("toast.created") : t("toast.saved"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("toast.saveFailed"))
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
      toast.error(error instanceof Error ? error.message : t("toast.deleteFailed"))
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
      toast.error(error instanceof Error ? error.message : t("toast.reindexFailed"))
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
      const message = error instanceof Error ? error.message : t("toast.previewFailed")
      setPreviewError(message)
      toast.error(message)
    } finally {
      setIsPreviewing(false)
    }
  }, [previewDraft, selectedAgent, t])

  const handlePreviewClaudeImport = React.useCallback(async (payload?: {
    files?: File[]
  }) => {
    try {
      setIsImportPreviewing(true)
      setClaudeImportError(null)
      const result = await previewClaudeAgentImport(payload)
      setClaudeImportPreview(result)
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : t("toast.importPreviewFailed")
      setClaudeImportError(message)
      toast.error(message)
      throw error
    } finally {
      setIsImportPreviewing(false)
    }
  }, [t])

  const handleImportClaudeAgents = React.useCallback(async (payload?: {
    files?: File[]
  }) => {
    try {
      setIsImporting(true)
      setClaudeImportError(null)
      const result: ImportClaudeAgentsResponse = await importClaudeAgents(payload)
      await mutateAgents((current = []) => {
        const byId = new Map(current.map((item) => [item.id, item]))
        for (const profile of result.profiles) {
          byId.set(profile.id, profile)
        }
        return Array.from(byId.values()).toSorted((left, right) =>
          right.updated_at.localeCompare(left.updated_at),
        )
      }, { revalidate: false })
      if (result.profiles[0]) {
        setSelectedAgentId(result.profiles[0].id)
        setCreateFlowStep("editor")
      }
      setClaudeImportPreview(null)
      toast.success(
        t("toast.imported", {
          created: result.created_count,
          updated: result.updated_count,
        }),
      )
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : t("toast.importFailed")
      setClaudeImportError(message)
      toast.error(message)
      throw error
    } finally {
      setIsImporting(false)
    }
  }, [mutateAgents, t])

  return {
    // Platform
    desktopSupport,
    isDesktop,

    // Data
    agents,
    agentsError,
    agentsLoading,
    bindingCatalog,
    bindingsLoading,
    modelGroups,
    isLoadingModels,

    // Selection
    selectedAgentId,
    selectedAgent,
    isStarterState,
    isImageWorkspace,
    isVoiceWorkspace,
    showBindingsWorkspace,

    // Draft
    draft,
    previewDraft,
    draftPayload,
    parsedModelConfig,
    parsedImageExtraParams,
    parsedVoiceExtraParams,
    hasUnsavedChanges,
    saveDisabled,

    // Model select
    taskAgentModelSelectValue,
    selectedTaskAgentModelOption,
    unknownTaskAgentModelLabel,

    // Filters
    searchQuery,
    kindFilter,
    statusFilter,
    toolQuery,
    skillQuery,
    showSelectedToolsOnly,
    showSelectedSkillsOnly,
    filteredAgents,
    groupedAgents,
    filteredBindingTools,
    filteredBindingSkills,

    // Computed
    stats,
    dateFormatter,

    // Operation state
    isSaving,
    isPreviewing,
    isReindexing,
    isImportPreviewing,
    isImporting,
    deleteDialogOpen,
    discardDialogOpen,
    previewResult,
    previewError,
    claudeImportPreview,
    claudeImportError,

    // Actions
    setSearchQuery,
    setKindFilter,
    setStatusFilter,
    setToolQuery,
    setSkillQuery,
    setShowSelectedToolsOnly,
    setShowSelectedSkillsOnly,
    setDeleteDialogOpen,
    setPreviewDraft,
    updateDraft,
    updateImageDraft,
    updateVoiceDraft,
    handleSelectAgent,
    handleCreateNew,
    handleSelectNewAgentType,
    handleTaskAgentModelChange,
    toggleBinding,
    handleSave,
    handleDelete,
    handleReindex,
    handleRunPreview,
    handlePreviewClaudeImport,
    handleImportClaudeAgents,
    handleDiscardConfirm,
    handleDiscardCancel,
  }
}

// Local helper to avoid circular import
function statusRank(status: string): number {
  switch (status) {
    case "healthy": return 0
    case "starting": case "pending": case "updating": return 1
    case "degraded": return 2
    case "stopped": return 3
    case "error": case "crashed": case "orphaned": return 4
    default: return 5
  }
}
