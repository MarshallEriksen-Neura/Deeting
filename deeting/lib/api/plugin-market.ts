import { z } from "zod"

import { getAuthToken, request } from "@/lib/http"

const PLUGIN_MARKET_BASE = "/api/v1/plugin-market"
const LIGHT_SYNC_COOLDOWN_MS = 15_000
let lastLightSyncAt = 0

export const PluginMarketSkillItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  version: z.string().nullable().optional(),
  source_repo: z.string().nullable().optional(),
  source_revision: z.string().nullable().optional(),
  status: z.string(),
  installed: z.boolean().default(false),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const PluginInstallationItemSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  skill_id: z.string(),
  alias: z.string().nullable().optional(),
  config_json: z.record(z.string(), z.unknown()).default({}),
  granted_permissions: z.array(z.string()).default([]),
  installed_revision: z.string().nullable().optional(),
  is_enabled: z.boolean(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export type PluginMarketSkillItem = z.infer<typeof PluginMarketSkillItemSchema>
export type PluginInstallationItem = z.infer<typeof PluginInstallationItemSchema>
export const LocalSkillInstallSyncItemSchema = z.object({
  skill_id: z.string(),
  is_enabled: z.boolean(),
  installed_revision: z.string().nullable().optional(),
  install_path: z.string(),
  status: z.string(),
  reinstalled: z.boolean(),
  error: z.string().nullable().optional(),
})

export const LocalSkillInstallSyncResponseSchema = z.object({
  fetched_count: z.number(),
  upserted_count: z.number(),
  reinstalled_count: z.number(),
  failed_count: z.number(),
  items: z.array(LocalSkillInstallSyncItemSchema).default([]),
})

export type LocalSkillInstallSyncResponse = z.infer<typeof LocalSkillInstallSyncResponseSchema>

export type PluginMarketQuery = {
  q?: string
  limit?: number
}

const isTauriRuntime = () =>
  process.env.NEXT_PUBLIC_IS_TAURI === "true" &&
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<T>(command, args)
}

type LocalSkillSyncOptions = {
  reinstallMissing?: boolean
  force?: boolean
}

export function isDesktopRuntime() {
  return isTauriRuntime()
}

export async function syncLocalSkillInstallsFromCloud(
  options: LocalSkillSyncOptions = {}
): Promise<LocalSkillInstallSyncResponse | null> {
  if (!isTauriRuntime()) {
    return null
  }

  const reinstallMissing = options.reinstallMissing ?? false
  if (!reinstallMissing && !options.force) {
    const now = Date.now()
    if (now - lastLightSyncAt < LIGHT_SYNC_COOLDOWN_MS) {
      return null
    }
    lastLightSyncAt = now
  }

  const tokenResolver = typeof getAuthToken === "function" ? getAuthToken : () => null
  const token = (tokenResolver() ?? "").trim()
  if (!token) {
    return null
  }

  const data = await invokeTauri<LocalSkillInstallSyncResponse>(
    "sync_local_skill_installs_from_cloud",
    {
      accessToken: token,
      reinstallMissing,
    }
  )
  return LocalSkillInstallSyncResponseSchema.parse(data)
}

async function trySyncLocalSkillInstallsFromCloud(
  options: LocalSkillSyncOptions = {}
): Promise<LocalSkillInstallSyncResponse | null> {
  try {
    return await syncLocalSkillInstallsFromCloud(options)
  } catch (error) {
    console.warn("[plugin-market] sync local skill installs from cloud failed", error)
    return null
  }
}

export async function fetchPluginMarket(query: PluginMarketQuery = {}) {
  if (isTauriRuntime()) {
    await trySyncLocalSkillInstallsFromCloud({ reinstallMissing: false })
  }

  const data = await request({
    url: `${PLUGIN_MARKET_BASE}/plugins`,
    method: "GET",
    params: query,
  })
  return z.array(PluginMarketSkillItemSchema).parse(data)
}

export async function fetchPluginInstalls() {
  if (isTauriRuntime()) {
    await trySyncLocalSkillInstallsFromCloud({ reinstallMissing: false })
  }

  const data = await request({
    url: `${PLUGIN_MARKET_BASE}/installs`,
    method: "GET",
  })
  return z.array(PluginInstallationItemSchema).parse(data)
}

export async function installPlugin(
  skillId: string,
  payload?: { alias?: string; config_json?: Record<string, unknown> }
) {
  const data = await request({
    url: `${PLUGIN_MARKET_BASE}/plugins/${skillId}/install`,
    method: "POST",
    data: payload ?? {},
  })
  const install = PluginInstallationItemSchema.parse(data)
  if (isTauriRuntime()) {
    await trySyncLocalSkillInstallsFromCloud({
      reinstallMissing: true,
      force: true,
    })
  }
  return install
}

export async function uninstallPlugin(skillId: string) {
  const response = await request({
    url: `${PLUGIN_MARKET_BASE}/plugins/${skillId}/install`,
    method: "DELETE",
  })
  if (isTauriRuntime()) {
    await trySyncLocalSkillInstallsFromCloud({
      reinstallMissing: false,
      force: true,
    })
  }
  return response
}

export async function submitPluginRepo(payload: {
  repo_url: string
  revision?: string
  skill_id?: string
  runtime_hint?: string
}) {
  return request({
    url: `${PLUGIN_MARKET_BASE}/plugins/submit`,
    method: "POST",
    data: payload,
  })
}
