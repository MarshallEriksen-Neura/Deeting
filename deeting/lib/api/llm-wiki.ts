import { z } from "zod"

import { isTauriRuntime } from "./desktop-config"

async function invokeTauri<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<T>(command, args)
}

export const LocalLlmWikiBindingSchema = z.object({
  vaultRoot: z.string(),
  vaultName: z.string(),
  workspaceRelativePath: z.string(),
  mode: z.string(),
  adoptedFolderRelativePath: z.string().nullish(),
  readScope: z.string(),
  writeScope: z.string(),
  isProbableObsidianVault: z.boolean(),
})

export const LocalLlmWikiWorkspaceStatusSchema = z.object({
  resolvedWorkspacePath: z.string(),
  workspaceExists: z.boolean(),
  hasReadme: z.boolean(),
  hasAgents: z.boolean(),
  hasHome: z.boolean(),
  hasIndex: z.boolean(),
  hasLog: z.boolean(),
  hasRaw: z.boolean(),
  hasWiki: z.boolean(),
  readyFileCount: z.number(),
  lastBootstrappedAt: z.string().nullish(),
})

export const LocalLlmWikiCorpusStatusSchema = z.object({
  indexedNoteCount: z.number(),
  managedWorkspaceNoteCount: z.number(),
  legacyVaultNoteCount: z.number(),
  pendingNoteCount: z.number(),
  failedNoteCount: z.number(),
  queuedChangeCount: z.number(),
  lastSyncedAt: z.string().nullish(),
})

export const LocalLlmWikiMaintainerAgentSummarySchema = z.object({
  agentId: z.string(),
  name: z.string(),
  sourcePath: z.string().nullish(),
  updatedAt: z.string(),
  discoverable: z.boolean(),
  isEnabled: z.boolean(),
})

export const LocalLlmWikiAutomationSettingsSchema = z.object({
  autoSyncOnVaultBound: z.boolean(),
  suggestMaintainerOnWorkspaceBootstrap: z.boolean(),
  autoRefreshInspectorOnCorpusSync: z.boolean(),
  createCrystallizationCandidatesOnSessionEnd: z.boolean(),
  enableScheduleSuggestions: z.boolean(),
  suggestOnValuableAnswer: z.boolean(),
  autoDelegateNewSources: z.boolean(),
  autoDelegateMaintenanceSchedule: z.boolean(),
  promoteRepeatedStableConclusionsToMemory: z.boolean(),
})

export const LocalLlmWikiAutomationSuggestionSchema = z.object({
  id: z.string(),
  fingerprint: z.string(),
  trigger: z.string(),
  actionKind: z.string(),
  title: z.string(),
  description: z.string(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
})

export const LocalLlmWikiAutomationAuditEntrySchema = z.object({
  id: z.string(),
  trigger: z.string(),
  level: z.string(),
  disposition: z.string(),
  message: z.string(),
  createdAt: z.string(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
})

export const LocalLlmWikiAutomationStateSchema = z.object({
  settings: LocalLlmWikiAutomationSettingsSchema,
  suggestions: z.array(LocalLlmWikiAutomationSuggestionSchema).default([]),
  audit: z.array(LocalLlmWikiAutomationAuditEntrySchema).default([]),
  lastScheduleRunAt: z.string().nullish(),
})

export const LocalLlmWikiStateSchema = z.object({
  binding: LocalLlmWikiBindingSchema.nullish(),
  workspaceStatus: LocalLlmWikiWorkspaceStatusSchema.nullish(),
  corpusStatus: LocalLlmWikiCorpusStatusSchema.nullish(),
  maintainerAgent: LocalLlmWikiMaintainerAgentSummarySchema.nullish(),
  recommendedAgentPrompt: z.string().nullish(),
  automation: LocalLlmWikiAutomationStateSchema,
  lastLintReport: z
    .object({
      generatedAt: z.string(),
      findingCount: z.number(),
      findings: z.array(
        z.object({
          id: z.string(),
          category: z.string(),
          severity: z.string(),
          confidence: z.string(),
          title: z.string(),
          detail: z.string(),
          relativePath: z.string().nullish(),
          relatedPaths: z.array(z.string()).default([]),
        }),
      ),
    })
    .nullish(),
})

export const BootstrapLocalLlmWikiWorkspaceResultSchema = z.object({
  workspacePath: z.string(),
  createdDirectories: z.array(z.string()).default([]),
  createdFiles: z.array(z.string()).default([]),
  skippedFiles: z.array(z.string()).default([]),
  state: LocalLlmWikiStateSchema,
})

export const CreateOrUpdateLocalLlmWikiMaintainerAgentResultSchema = z.object({
  state: LocalLlmWikiStateSchema,
})

export const ReconcileLocalLlmWikiCorpusResultSchema = z.object({
  indexedFiles: z.number(),
  removedFiles: z.number(),
  state: LocalLlmWikiStateSchema,
})

export const LocalLlmWikiCorpusSearchHitSchema = z.object({
  assetId: z.string(),
  docId: z.string(),
  chunkIndex: z.number(),
  relativePath: z.string(),
  title: z.string(),
  scope: z.string(),
  summary: z.string(),
  lexicalScore: z.number(),
  semanticScore: z.number(),
  score: z.number(),
})

export const SearchLocalLlmWikiCorpusResultSchema = z.object({
  hits: z.array(LocalLlmWikiCorpusSearchHitSchema).default([]),
})

export const LocalLlmWikiCandidateSourceReferenceSchema = z.object({
  sourceType: z.string(),
  sourceId: z.string().nullish(),
  title: z.string().nullish(),
  path: z.string().nullish(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
})

export const LocalLlmWikiCandidateChangedFileSchema = z.object({
  relativePath: z.string(),
  changeKind: z.string(),
})

export const LocalLlmWikiCandidateValidationFlagSchema = z.object({
  code: z.string(),
  severity: z.string(),
  message: z.string(),
})

export const LocalLlmWikiCandidatePreviewSchema = z.object({
  sourceKind: z.string(),
  suggestedTitle: z.string(),
  targetRelativePath: z.string(),
  sourceReferences: z
    .array(LocalLlmWikiCandidateSourceReferenceSchema)
    .default([]),
  proposedMarkdown: z.string(),
  changedFiles: z.array(LocalLlmWikiCandidateChangedFileSchema).default([]),
  validationFlags: z
    .array(LocalLlmWikiCandidateValidationFlagSchema)
    .default([]),
  memoryImpact: z.string(),
  canCommit: z.boolean(),
})

export const CommitLocalLlmWikiCandidateResultSchema = z.object({
  targetRelativePath: z.string(),
  changedFiles: z.array(LocalLlmWikiCandidateChangedFileSchema).default([]),
  state: LocalLlmWikiStateSchema,
})

export const LocalLlmWikiAutomationExecutionResultSchema = z.object({
  state: LocalLlmWikiStateSchema,
  workflowRunId: z.string().nullable().optional(),
  memoryAction: z.string().nullable().optional(),
  message: z.string().nullable().optional(),
})

export const LocalLlmWikiAdoptionPreviewSchema = z.object({
  targetRelativePath: z.string(),
  canAdopt: z.boolean(),
  summaryMessage: z.string(),
  bucketedCounts: z.array(
    z.object({
      kind: z.string(),
      count: z.number(),
      examples: z.array(z.string()).default([]),
    }),
  ),
})

export const IngestLocalLlmWikiSelectionResultSchema = z.object({
  ingestedPaths: z.array(z.string()).default([]),
  skippedPaths: z.array(z.string()).default([]),
  sourcePagesCreated: z.array(z.string()).default([]),
  rawFilesCopied: z.array(z.string()).default([]),
  state: LocalLlmWikiStateSchema,
})

export const LocalLlmWikiLintReportSchema = z.object({
  generatedAt: z.string(),
  findingCount: z.number(),
  findings: z.array(
    z.object({
      id: z.string(),
      category: z.string(),
      severity: z.string(),
      confidence: z.string(),
      title: z.string(),
      detail: z.string(),
      relativePath: z.string().nullish(),
      relatedPaths: z.array(z.string()).default([]),
    }),
  ),
})

export type LocalLlmWikiBinding = z.infer<typeof LocalLlmWikiBindingSchema>
export type LocalLlmWikiWorkspaceStatus = z.infer<
  typeof LocalLlmWikiWorkspaceStatusSchema
>
export type LocalLlmWikiCorpusStatus = z.infer<
  typeof LocalLlmWikiCorpusStatusSchema
>
export type LocalLlmWikiMaintainerAgentSummary = z.infer<
  typeof LocalLlmWikiMaintainerAgentSummarySchema
>
export type LocalLlmWikiAutomationSettings = z.infer<
  typeof LocalLlmWikiAutomationSettingsSchema
>
export type LocalLlmWikiAutomationSuggestion = z.infer<
  typeof LocalLlmWikiAutomationSuggestionSchema
>
export type LocalLlmWikiAutomationAuditEntry = z.infer<
  typeof LocalLlmWikiAutomationAuditEntrySchema
>
export type LocalLlmWikiAutomationState = z.infer<
  typeof LocalLlmWikiAutomationStateSchema
>
export type LocalLlmWikiState = z.infer<typeof LocalLlmWikiStateSchema>
export type BootstrapLocalLlmWikiWorkspaceResult = z.infer<
  typeof BootstrapLocalLlmWikiWorkspaceResultSchema
>
export type CreateOrUpdateLocalLlmWikiMaintainerAgentResult = z.infer<
  typeof CreateOrUpdateLocalLlmWikiMaintainerAgentResultSchema
>
export type ReconcileLocalLlmWikiCorpusResult = z.infer<
  typeof ReconcileLocalLlmWikiCorpusResultSchema
>
export type LocalLlmWikiCorpusSearchHit = z.infer<
  typeof LocalLlmWikiCorpusSearchHitSchema
>
export type SearchLocalLlmWikiCorpusResult = z.infer<
  typeof SearchLocalLlmWikiCorpusResultSchema
>
export type LocalLlmWikiCandidateSourceReference = z.infer<
  typeof LocalLlmWikiCandidateSourceReferenceSchema
>
export type LocalLlmWikiCandidateChangedFile = z.infer<
  typeof LocalLlmWikiCandidateChangedFileSchema
>
export type LocalLlmWikiCandidateValidationFlag = z.infer<
  typeof LocalLlmWikiCandidateValidationFlagSchema
>
export type LocalLlmWikiCandidatePreview = z.infer<
  typeof LocalLlmWikiCandidatePreviewSchema
>
export type CommitLocalLlmWikiCandidateResult = z.infer<
  typeof CommitLocalLlmWikiCandidateResultSchema
>
export type LocalLlmWikiAutomationExecutionResult = z.infer<
  typeof LocalLlmWikiAutomationExecutionResultSchema
>
export type LocalLlmWikiAdoptionPreview = z.infer<
  typeof LocalLlmWikiAdoptionPreviewSchema
>
export type IngestLocalLlmWikiSelectionResult = z.infer<
  typeof IngestLocalLlmWikiSelectionResultSchema
>
export type LocalLlmWikiLintReport = z.infer<typeof LocalLlmWikiLintReportSchema>

export interface SaveLocalLlmWikiBindingPayload {
  vaultRoot: string
  workspaceRelativePath?: string
  mode?: string
  adoptedFolderRelativePath?: string
}

export interface SearchLocalLlmWikiCorpusPayload {
  query: string
  limit?: number
}

export interface PreviewLocalLlmWikiCandidatePayload {
  sourceKind: string
  title: string
  content: string
  summary?: string
  targetRelativePath?: string
  sourceReferences?: LocalLlmWikiCandidateSourceReference[]
  metadata?: Record<string, unknown>
}

export interface CommitLocalLlmWikiCandidatePayload {
  preview: LocalLlmWikiCandidatePreview
}

export interface UpdateLocalLlmWikiAutomationSettingsPayload {
  autoSyncOnVaultBound?: boolean
  suggestMaintainerOnWorkspaceBootstrap?: boolean
  autoRefreshInspectorOnCorpusSync?: boolean
  createCrystallizationCandidatesOnSessionEnd?: boolean
  enableScheduleSuggestions?: boolean
  suggestOnValuableAnswer?: boolean
  autoDelegateNewSources?: boolean
  autoDelegateMaintenanceSchedule?: boolean
  promoteRepeatedStableConclusionsToMemory?: boolean
}

export interface PreviewLocalLlmWikiAdoptionPayload {
  vaultRoot: string
  folderRelativePath: string
}

export interface ConfirmLocalLlmWikiAdoptionPayload {
  vaultRoot: string
  folderRelativePath: string
}

export interface IngestLocalLlmWikiSelectionPayload {
  selectedRelativePaths: string[]
}

export function supportsLocalLlmWiki(): boolean {
  return isTauriRuntime()
}

export async function getLocalLlmWikiState(): Promise<LocalLlmWikiState> {
  if (!isTauriRuntime()) {
    return LocalLlmWikiStateSchema.parse({
      binding: null,
      workspaceStatus: null,
      corpusStatus: null,
      maintainerAgent: null,
      recommendedAgentPrompt: null,
      automation: {
        settings: {
          autoSyncOnVaultBound: true,
          suggestMaintainerOnWorkspaceBootstrap: true,
          autoRefreshInspectorOnCorpusSync: true,
          createCrystallizationCandidatesOnSessionEnd: true,
          enableScheduleSuggestions: true,
          suggestOnValuableAnswer: true,
          autoDelegateNewSources: false,
          autoDelegateMaintenanceSchedule: false,
          promoteRepeatedStableConclusionsToMemory: false,
        },
        suggestions: [],
        audit: [],
        lastScheduleRunAt: null,
      },
      lastLintReport: null,
    })
  }

  const data = await invokeTauri<unknown>("get_local_llm_wiki_state_command")
  return LocalLlmWikiStateSchema.parse(data)
}

export async function saveLocalLlmWikiBinding(
  payload: SaveLocalLlmWikiBindingPayload,
): Promise<LocalLlmWikiState> {
  const data = await invokeTauri<unknown>(
    "save_local_llm_wiki_binding_command",
    {
      payload: {
        vaultRoot: payload.vaultRoot,
        workspaceRelativePath: payload.workspaceRelativePath ?? null,
        mode: payload.mode ?? null,
        adoptedFolderRelativePath: payload.adoptedFolderRelativePath ?? null,
      },
    },
  )
  return LocalLlmWikiStateSchema.parse(data)
}

export async function bootstrapLocalLlmWikiWorkspace(): Promise<BootstrapLocalLlmWikiWorkspaceResult> {
  const data = await invokeTauri<unknown>(
    "bootstrap_local_llm_wiki_workspace_command",
  )
  return BootstrapLocalLlmWikiWorkspaceResultSchema.parse(data)
}

export async function createOrUpdateLocalLlmWikiMaintainerAgent(): Promise<CreateOrUpdateLocalLlmWikiMaintainerAgentResult> {
  const data = await invokeTauri<unknown>(
    "create_or_update_local_llm_wiki_maintainer_agent_command",
  )
  return CreateOrUpdateLocalLlmWikiMaintainerAgentResultSchema.parse(data)
}

export async function reconcileLocalLlmWikiCorpus(): Promise<ReconcileLocalLlmWikiCorpusResult> {
  const data = await invokeTauri<unknown>("reconcile_local_llm_wiki_corpus_command")
  return ReconcileLocalLlmWikiCorpusResultSchema.parse(data)
}

export async function searchLocalLlmWikiCorpus(
  payload: SearchLocalLlmWikiCorpusPayload,
): Promise<SearchLocalLlmWikiCorpusResult> {
  const data = await invokeTauri<unknown>("search_local_llm_wiki_corpus_command", {
    payload,
  })
  return SearchLocalLlmWikiCorpusResultSchema.parse(data)
}

export async function previewLocalLlmWikiCandidate(
  payload: PreviewLocalLlmWikiCandidatePayload,
): Promise<LocalLlmWikiCandidatePreview> {
  const data = await invokeTauri<unknown>(
    "preview_local_llm_wiki_candidate_command",
    {
      payload: {
        sourceKind: payload.sourceKind,
        title: payload.title,
        content: payload.content,
        summary: payload.summary ?? null,
        targetRelativePath: payload.targetRelativePath ?? null,
        sourceReferences: payload.sourceReferences ?? [],
        metadata: payload.metadata ?? null,
      },
    },
  )
  return LocalLlmWikiCandidatePreviewSchema.parse(data)
}

export async function commitLocalLlmWikiCandidate(
  payload: CommitLocalLlmWikiCandidatePayload,
): Promise<CommitLocalLlmWikiCandidateResult> {
  const data = await invokeTauri<unknown>(
    "commit_local_llm_wiki_candidate_command",
    { payload },
  )
  return CommitLocalLlmWikiCandidateResultSchema.parse(data)
}

export async function updateLocalLlmWikiAutomationSettings(
  payload: UpdateLocalLlmWikiAutomationSettingsPayload,
): Promise<LocalLlmWikiState> {
  const data = await invokeTauri<unknown>(
    "update_local_llm_wiki_automation_settings_command",
    { payload },
  )
  return LocalLlmWikiStateSchema.parse(data)
}

export async function dismissLocalLlmWikiAutomationSuggestion(
  suggestionId: string,
): Promise<LocalLlmWikiState> {
  const data = await invokeTauri<unknown>(
    "dismiss_local_llm_wiki_automation_suggestion_command",
    { suggestionId },
  )
  return LocalLlmWikiStateSchema.parse(data)
}

export async function executeLocalLlmWikiAutomationSuggestion(
  suggestionId: string,
): Promise<LocalLlmWikiAutomationExecutionResult> {
  const data = await invokeTauri<unknown>(
    "execute_local_llm_wiki_automation_suggestion_command",
    { suggestionId },
  )
  return LocalLlmWikiAutomationExecutionResultSchema.parse(data)
}

export async function previewLocalLlmWikiAdoption(
  payload: PreviewLocalLlmWikiAdoptionPayload,
): Promise<LocalLlmWikiAdoptionPreview> {
  const data = await invokeTauri<unknown>("preview_local_llm_wiki_adoption_command", {
    payload,
  })
  return LocalLlmWikiAdoptionPreviewSchema.parse(data)
}

export async function confirmLocalLlmWikiAdoption(
  payload: ConfirmLocalLlmWikiAdoptionPayload,
): Promise<LocalLlmWikiState> {
  const data = await invokeTauri<unknown>("confirm_local_llm_wiki_adoption_command", {
    payload,
  })
  return LocalLlmWikiStateSchema.parse(data)
}

export async function ingestLocalLlmWikiSelection(
  payload: IngestLocalLlmWikiSelectionPayload,
): Promise<IngestLocalLlmWikiSelectionResult> {
  const data = await invokeTauri<unknown>("ingest_local_llm_wiki_selection_command", {
    payload,
  })
  return IngestLocalLlmWikiSelectionResultSchema.parse(data)
}

export async function runLocalLlmWikiLint(): Promise<LocalLlmWikiLintReport> {
  const data = await invokeTauri<unknown>("run_local_llm_wiki_lint_command")
  return LocalLlmWikiLintReportSchema.parse(data)
}
