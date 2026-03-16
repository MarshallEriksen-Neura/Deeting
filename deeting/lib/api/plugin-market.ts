import { z } from "zod"

import { request } from "@/lib/http"

import { isTauriRuntime } from "./desktop-config"

const PLUGIN_MARKET_BASE = "/api/v1/plugin-market"

export const PluginMarketSkillItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  version: z.string().nullable().optional(),
  source_repo: z.string().nullable().optional(),
  source_revision: z.string().nullable().optional(),
  source_kind: z.string().default("community"),
  status: z.string(),
  installed: z.boolean().default(false),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  compatibility: z.unknown().optional(),
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

export const LocalSkillRuntimeRequirementStatusSchema = z.object({
  key: z.string(),
  configured: z.boolean(),
  source: z.string().nullable().optional(),
})

export const LocalSkillRuntimeStatusSchema = z.object({
  skill_id: z.string(),
  display_name: z.string(),
  installed_version: z.string().nullable().optional(),
  is_enabled: z.boolean(),
  execution_mode: z.string(),
  ecosystem: z.string(),
  adapter_kind: z.string().default("unknown"),
  normalized_execution_surface: z.string().default("recipe"),
  runnable_now: z.boolean(),
  required_bins: z.array(z.string()).default([]),
  missing_bins: z.array(z.string()).default([]),
  required_env: z.array(LocalSkillRuntimeRequirementStatusSchema).default([]),
  missing_env: z.array(z.string()).default([]),
  required_config: z.array(LocalSkillRuntimeRequirementStatusSchema).default([]),
  missing_config: z.array(z.string()).default([]),
  blocking_reason: z.string().nullable().optional(),
  install_hints: z.array(z.string()).default([]),
  runtime_install_supported: z.boolean().default(false),
  runtime_kind: z.string().nullable().optional(),
  runtime_install_state: z.string().default("unsupported"),
  runtime_install_manager: z.string().nullable().optional(),
  runtime_manager_available: z.boolean().default(false),
  runtime_install_error: z.string().nullable().optional(),
  runtime_dependency_manifest_path: z.string().nullable().optional(),
  runtime_command_path: z.string().nullable().optional(),
  compatibility: z.unknown(),
  current_env: z.record(z.string(), z.string()).default({}),
  current_config: z.record(z.string(), z.unknown()).default({}),
})

export type LocalSkillRuntimeStatus = z.infer<typeof LocalSkillRuntimeStatusSchema>

const LocalSkillInstallResultSchema = z.object({
  skill_id: z.string(),
  tool_count: z.number(),
  install_path: z.string(),
})

export function isUserVisiblePlugin(plugin: PluginMarketSkillItem) {
  return plugin.source_kind !== "official"
}

export type PluginMarketQuery = {
  q?: string
  limit?: number
}

export function isDesktopRuntime() {
  return isTauriRuntime()
}

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<T>(command, args)
}

function normalizeInstalledSkillId(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  let normalized = ""
  let previousWasSeparator = false
  for (const char of trimmed.toLowerCase()) {
    if ((char >= "a" && char <= "z") || (char >= "0" && char <= "9")) {
      normalized += char
      previousWasSeparator = false
    } else if (!previousWasSeparator) {
      normalized += "-"
      previousWasSeparator = true
    }
  }

  const canonical = normalized.replace(/^-+|-+$/g, "")
  return canonical.length > 0 ? canonical : null
}

function normalizeInstalledSkillRepoKey(value?: string | null): string | null {
  const trimmed = value?.trim()
  if (!trimmed) {
    return null
  }

  let normalized = trimmed.replace(/\\/g, "/").toLowerCase()
  if (normalized.startsWith("git@github.com:")) {
    normalized = `https://github.com/${normalized.slice("git@github.com:".length)}`
  }
  normalized = normalized.replace(/\/+$/g, "").replace(/\.git$/g, "")
  return normalized.length > 0 ? `repo:${normalized}` : null
}

function buildInstalledSkillMatchKeys(plugin: PluginMarketSkillItem): string[] {
  const keys = new Set<string>()
  const rawId = plugin.id.trim()
  if (rawId) {
    keys.add(rawId)
  }
  const normalizedId = normalizeInstalledSkillId(plugin.id)
  if (normalizedId) {
    keys.add(normalizedId)
  }
  const repoKey = normalizeInstalledSkillRepoKey(plugin.source_repo)
  if (repoKey) {
    keys.add(repoKey)
  }
  return Array.from(keys)
}

async function listLocalInstalledSkillIds(): Promise<Set<string>> {
  if (!isTauriRuntime()) {
    return new Set()
  }

  const data = await invokeTauri<string[]>("list_local_installed_skill_ids")
  const ids = z.array(z.string()).parse(data)
  return new Set(ids)
}

export async function fetchPluginMarket(query: PluginMarketQuery = {}) {
  const data = await request({
    url: `${PLUGIN_MARKET_BASE}/plugins`,
    method: "GET",
    params: query,
  })
  const plugins = z.array(PluginMarketSkillItemSchema).parse(data)

  if (!isTauriRuntime()) {
    return plugins
  }

  try {
    const installedIds = await listLocalInstalledSkillIds()
    return plugins.map((plugin) => ({
      ...plugin,
      installed: buildInstalledSkillMatchKeys(plugin).some((key) => installedIds.has(key)),
    }))
  } catch (error) {
    console.warn("[plugin-market] load local installed skill ids failed", error)
    return plugins
  }
}

export async function fetchPluginInstalls() {
  const data = await request({
    url: `${PLUGIN_MARKET_BASE}/installs`,
    method: "GET",
  })
  return z.array(PluginInstallationItemSchema).parse(data)
}

export async function installPlugin(
  plugin: Pick<PluginMarketSkillItem, "id" | "source_repo" | "source_revision">,
  payload?: { alias?: string; config_json?: Record<string, unknown> }
) {
  if (isTauriRuntime()) {
    const repoUrl = (plugin.source_repo ?? "").trim()
    if (!repoUrl) {
      throw new Error("Local desktop install requires source_repo")
    }

    const data = await invokeTauri("install_skill_from_repo", {
      repoUrl,
      revision: plugin.source_revision ?? undefined,
      alias: payload?.alias ?? undefined,
    })
    return LocalSkillInstallResultSchema.parse(data)
  }

  const data = await request({
    url: `${PLUGIN_MARKET_BASE}/plugins/${plugin.id}/install`,
    method: "POST",
    data: payload ?? {},
  })
  return PluginInstallationItemSchema.parse(data)
}

export async function uninstallPlugin(skillId: string) {
  if (isTauriRuntime()) {
    await invokeTauri("uninstall_skill", {
      skillId,
    })
    return null
  }

  const response = await request({
    url: `${PLUGIN_MARKET_BASE}/plugins/${skillId}/install`,
    method: "DELETE",
  })
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

export async function fetchLocalSkillRuntimeStatuses(): Promise<LocalSkillRuntimeStatus[]> {
  if (!isTauriRuntime()) {
    return []
  }
  const data = await invokeTauri("list_local_skill_runtime_statuses")
  return z.array(LocalSkillRuntimeStatusSchema).parse(data)
}

export async function updateLocalSkillRuntimeSettings(
  skillId: string,
  payload: {
    env_json?: Record<string, string>
    config_json?: Record<string, unknown>
  }
): Promise<LocalSkillRuntimeStatus> {
  if (!isTauriRuntime()) {
    throw new Error("Local skill runtime settings require desktop runtime")
  }
  const data = await invokeTauri("update_local_skill_runtime_settings", {
    skillId,
    payload,
  })
  return LocalSkillRuntimeStatusSchema.parse(data)
}

export async function installLocalSkillRuntime(
  skillId: string
): Promise<LocalSkillRuntimeStatus> {
  if (!isTauriRuntime()) {
    throw new Error("Local skill runtime install requires desktop runtime")
  }
  const data = await invokeTauri("install_local_skill_runtime", {
    skillId,
  })
  return LocalSkillRuntimeStatusSchema.parse(data)
}
