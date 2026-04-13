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
  readScope: z.string(),
  writeScope: z.string(),
  isProbableObsidianVault: z.boolean(),
})

export const LocalLlmWikiCandidateFolderSchema = z.object({
  relativePath: z.string(),
  reason: z.string(),
  score: z.number(),
})

export const LocalLlmWikiVaultScanSummarySchema = z.object({
  detectedObsidianConfig: z.boolean(),
  totalMarkdownFiles: z.number(),
  totalAttachmentFiles: z.number(),
  totalDirectories: z.number(),
  candidateFolders: z.array(LocalLlmWikiCandidateFolderSchema).default([]),
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

export const LocalLlmWikiStateSchema = z.object({
  binding: LocalLlmWikiBindingSchema.nullish(),
  scanSummary: LocalLlmWikiVaultScanSummarySchema.nullish(),
  workspaceStatus: LocalLlmWikiWorkspaceStatusSchema.nullish(),
  corpusStatus: LocalLlmWikiCorpusStatusSchema.nullish(),
  maintainerAgent: LocalLlmWikiMaintainerAgentSummarySchema.nullish(),
  recommendedAgentPrompt: z.string().nullish(),
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

export const SyncLocalLlmWikiCorpusResultSchema = z.object({
  indexedFiles: z.number(),
  removedFiles: z.number(),
  state: LocalLlmWikiStateSchema,
})

export const LocalLlmWikiCorpusSearchHitSchema = z.object({
  assetId: z.string(),
  relativePath: z.string(),
  title: z.string(),
  scope: z.string(),
  summary: z.string(),
  score: z.number(),
})

export const SearchLocalLlmWikiCorpusResultSchema = z.object({
  hits: z.array(LocalLlmWikiCorpusSearchHitSchema).default([]),
})

export type LocalLlmWikiBinding = z.infer<typeof LocalLlmWikiBindingSchema>
export type LocalLlmWikiCandidateFolder = z.infer<
  typeof LocalLlmWikiCandidateFolderSchema
>
export type LocalLlmWikiVaultScanSummary = z.infer<
  typeof LocalLlmWikiVaultScanSummarySchema
>
export type LocalLlmWikiWorkspaceStatus = z.infer<
  typeof LocalLlmWikiWorkspaceStatusSchema
>
export type LocalLlmWikiCorpusStatus = z.infer<
  typeof LocalLlmWikiCorpusStatusSchema
>
export type LocalLlmWikiMaintainerAgentSummary = z.infer<
  typeof LocalLlmWikiMaintainerAgentSummarySchema
>
export type LocalLlmWikiState = z.infer<typeof LocalLlmWikiStateSchema>
export type BootstrapLocalLlmWikiWorkspaceResult = z.infer<
  typeof BootstrapLocalLlmWikiWorkspaceResultSchema
>
export type CreateOrUpdateLocalLlmWikiMaintainerAgentResult = z.infer<
  typeof CreateOrUpdateLocalLlmWikiMaintainerAgentResultSchema
>
export type SyncLocalLlmWikiCorpusResult = z.infer<
  typeof SyncLocalLlmWikiCorpusResultSchema
>
export type LocalLlmWikiCorpusSearchHit = z.infer<
  typeof LocalLlmWikiCorpusSearchHitSchema
>
export type SearchLocalLlmWikiCorpusResult = z.infer<
  typeof SearchLocalLlmWikiCorpusResultSchema
>

export interface SaveLocalLlmWikiBindingPayload {
  vaultRoot: string
  workspaceRelativePath?: string
}

export interface SearchLocalLlmWikiCorpusPayload {
  query: string
  limit?: number
}

export function supportsLocalLlmWiki(): boolean {
  return isTauriRuntime()
}

export async function getLocalLlmWikiState(): Promise<LocalLlmWikiState> {
  if (!isTauriRuntime()) {
    return LocalLlmWikiStateSchema.parse({
      binding: null,
      scanSummary: null,
      workspaceStatus: null,
      corpusStatus: null,
      maintainerAgent: null,
      recommendedAgentPrompt: null,
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
    { payload },
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

export async function syncLocalLlmWikiCorpus(): Promise<SyncLocalLlmWikiCorpusResult> {
  const data = await invokeTauri<unknown>("sync_local_llm_wiki_corpus_command")
  return SyncLocalLlmWikiCorpusResultSchema.parse(data)
}

export async function searchLocalLlmWikiCorpus(
  payload: SearchLocalLlmWikiCorpusPayload,
): Promise<SearchLocalLlmWikiCorpusResult> {
  const data = await invokeTauri<unknown>("search_local_llm_wiki_corpus_command", {
    payload,
  })
  return SearchLocalLlmWikiCorpusResultSchema.parse(data)
}
