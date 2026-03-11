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
