import { z } from "zod"

import { request } from "@/lib/http"

const PLUGIN_MARKET_BASE = "/api/v1/plugin-market"

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

export type PluginMarketQuery = {
  q?: string
  limit?: number
}

export async function fetchPluginMarket(query: PluginMarketQuery = {}) {
  const data = await request({
    url: `${PLUGIN_MARKET_BASE}/plugins`,
    method: "GET",
    params: query,
  })
  return z.array(PluginMarketSkillItemSchema).parse(data)
}

export async function fetchPluginInstalls() {
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
  return PluginInstallationItemSchema.parse(data)
}

export async function uninstallPlugin(skillId: string) {
  return request({
    url: `${PLUGIN_MARKET_BASE}/plugins/${skillId}/install`,
    method: "DELETE",
  })
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
