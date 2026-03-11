import { z } from "zod"

import { getAuthToken } from "@/lib/http"

import { isTauriRuntime } from "./desktop-config"

const LIGHT_SYNC_COOLDOWN_MS = 15_000
let lastSystemAssetSyncAt = 0

const LocalSystemAssetSyncResponseSchema = z.object({
  fetched_count: z.number(),
  assistant_fetched_count: z.number(),
  skill_fetched_count: z.number(),
  upserted_count: z.number(),
  hidden_count: z.number(),
  metadata_only_count: z.number(),
  executable_count: z.number(),
  archived_count: z.number(),
  skill_install_fetched_count: z.number(),
  skill_install_upserted_count: z.number(),
  skill_reinstalled_count: z.number(),
  skill_failed_count: z.number(),
  disabled_skill_count: z.number(),
  archived_assistant_count: z.number(),
})

export type LocalSystemAssetSyncResponse = z.infer<typeof LocalSystemAssetSyncResponseSchema>

const LocalSystemAssetRepairResponseSchema = z.object({
  vector_dimension: z.number(),
  skill_reindexed_count: z.number(),
  assistant_reindexed_count: z.number(),
  sync: LocalSystemAssetSyncResponseSchema,
})

export type LocalSystemAssetRepairResponse = z.infer<typeof LocalSystemAssetRepairResponseSchema>

const LocalMaintenanceActionRequestSchema = z.object({
  kind: z.string(),
  limit: z.number().optional(),
  reinstallMissing: z.boolean().optional(),
})

const LocalMaintenanceLogItemSchema = z.object({
  id: z.string(),
  kind: z.string(),
  status: z.string(),
  message: z.string(),
  details: z.unknown().nullish(),
  created_at: z.string(),
})

const LocalMaintenanceLogListResponseSchema = z.object({
  total: z.number(),
  skip: z.number(),
  limit: z.number(),
  items: z.array(LocalMaintenanceLogItemSchema),
})

export type LocalMaintenanceActionRequest = z.infer<typeof LocalMaintenanceActionRequestSchema>
export type LocalMaintenanceLogItem = z.infer<typeof LocalMaintenanceLogItemSchema>
export type LocalMaintenanceLogListResponse = z.infer<typeof LocalMaintenanceLogListResponseSchema>

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<T>(command, args)
}

export async function syncLocalSystemAssetsFromCloud(options?: {
  force?: boolean
  limit?: number
  reinstallMissing?: boolean
}): Promise<LocalSystemAssetSyncResponse | null> {
  if (!isTauriRuntime()) {
    return null
  }

  const force = options?.force ?? false
  if (!force) {
    const now = Date.now()
    if (now - lastSystemAssetSyncAt < LIGHT_SYNC_COOLDOWN_MS) {
      return null
    }
    lastSystemAssetSyncAt = now
  }

  const tokenResolver = typeof getAuthToken === "function" ? getAuthToken : () => null
  const token = (tokenResolver() ?? "").trim()
  if (!token) {
    return null
  }

  const data = await invokeTauri<LocalSystemAssetSyncResponse>("sync_local_system_assets", {
    accessToken: token,
    limit: options?.limit ?? 500,
    reinstallMissing: options?.reinstallMissing ?? false,
  })
  return LocalSystemAssetSyncResponseSchema.parse(data)
}

export async function trySyncLocalSystemAssetsFromCloud(options?: {
  force?: boolean
  limit?: number
  reinstallMissing?: boolean
}): Promise<LocalSystemAssetSyncResponse | null> {
  try {
    return await syncLocalSystemAssetsFromCloud(options)
  } catch (error) {
    console.warn("[desktop-system-assets] sync local system assets from cloud failed", error)
    return null
  }
}

export async function repairLocalSystemAssetIndexFromCloud(options?: {
  limit?: number
  reinstallMissing?: boolean
}): Promise<LocalSystemAssetRepairResponse | null> {
  if (!isTauriRuntime()) {
    return null
  }

  const tokenResolver = typeof getAuthToken === "function" ? getAuthToken : () => null
  const token = (tokenResolver() ?? "").trim()
  if (!token) {
    return null
  }

  const data = await invokeTauri<LocalSystemAssetRepairResponse>(
    "repair_local_system_asset_index",
    {
      accessToken: token,
      limit: options?.limit ?? 500,
      reinstallMissing: options?.reinstallMissing ?? false,
    }
  )
  return LocalSystemAssetRepairResponseSchema.parse(data)
}

export async function tryRepairLocalSystemAssetIndexFromCloud(options?: {
  limit?: number
  reinstallMissing?: boolean
}): Promise<LocalSystemAssetRepairResponse | null> {
  try {
    return await repairLocalSystemAssetIndexFromCloud(options)
  } catch (error) {
    console.warn("[desktop-system-assets] repair local system asset index failed", error)
    return null
  }
}

export async function runLocalMaintenanceAction(
  request: LocalMaintenanceActionRequest
): Promise<LocalMaintenanceLogItem | null> {
  if (!isTauriRuntime()) {
    return null
  }

  const tokenResolver = typeof getAuthToken === "function" ? getAuthToken : () => null
  const token = (tokenResolver() ?? "").trim()
  if (!token) {
    return null
  }

  const normalizedRequest = LocalMaintenanceActionRequestSchema.parse(request)
  const data = await invokeTauri<LocalMaintenanceLogItem>("run_local_maintenance_action", {
    accessToken: token,
    request: {
      kind: normalizedRequest.kind,
      limit: normalizedRequest.limit ?? 500,
      reinstallMissing: normalizedRequest.reinstallMissing ?? false,
    },
  })
  return LocalMaintenanceLogItemSchema.parse(data)
}

export async function listLocalMaintenanceLogs(options?: {
  limit?: number
  skip?: number
  kind?: string
  status?: string
}): Promise<LocalMaintenanceLogListResponse | null> {
  if (!isTauriRuntime()) {
    return null
  }

  const data = await invokeTauri<LocalMaintenanceLogListResponse>("list_local_maintenance_logs", {
    query: {
      limit: options?.limit ?? 10,
      skip: options?.skip ?? 0,
      kind: options?.kind,
      status: options?.status,
    },
  })
  return LocalMaintenanceLogListResponseSchema.parse(data)
}
