import {
  isUserVisiblePlugin,
  type LocalSkillRuntimeStatus,
  type PluginMarketSkillItem,
} from "@/lib/api/plugin-market"

type RuntimeStatusRecord = Record<string, LocalSkillRuntimeStatus>

type PluginRuntimeViewModel = {
  userVisiblePlugins: PluginMarketSkillItem[]
  installedPlugins: PluginMarketSkillItem[]
  runtimeStatusByPluginId: Record<string, LocalSkillRuntimeStatus>
}

function normalizeSkillKey(value: string): string | null {
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

function buildSkillIdentityKeys(value: string): Set<string> {
  const keys = new Set<string>()
  const trimmed = value.trim()
  if (!trimmed) {
    return keys
  }

  keys.add(trimmed)
  keys.add(trimmed.toLowerCase())

  const normalized = normalizeSkillKey(trimmed)
  if (normalized) {
    keys.add(normalized)
  }

  const lower = trimmed.toLowerCase()
  if (lower.startsWith("skill.")) {
    const suffix = trimmed.slice("skill.".length)
    if (suffix) {
      keys.add(suffix)
      keys.add(suffix.toLowerCase())
      const normalizedSuffix = normalizeSkillKey(suffix)
      if (normalizedSuffix) {
        keys.add(normalizedSuffix)
      }
    }
  }

  return keys
}

function isOfficialLocalSkillId(skillId: string): boolean {
  return skillId.trim().toLowerCase().startsWith("official.")
}

function findMatchingRuntimeStatus(
  plugin: Pick<PluginMarketSkillItem, "id">,
  statuses: LocalSkillRuntimeStatus[],
): LocalSkillRuntimeStatus | null {
  const pluginKeys = buildSkillIdentityKeys(plugin.id)

  for (const status of statuses) {
    const statusKeys = buildSkillIdentityKeys(status.skill_id)
    for (const key of pluginKeys) {
      if (statusKeys.has(key)) {
        return status
      }
    }
  }

  return null
}

function buildRuntimeOnlyPlugin(status: LocalSkillRuntimeStatus): PluginMarketSkillItem {
  return {
    id: status.skill_id,
    name: status.display_name,
    description: null,
    version: status.installed_version ?? null,
    source_repo: null,
    source_revision: null,
    source_kind: isOfficialLocalSkillId(status.skill_id) ? "official" : "community",
    status: status.is_enabled ? "active" : "inactive",
    installed: true,
    compatibility: status.compatibility,
    created_at: null,
    updated_at: null,
  }
}

export function buildPluginRuntimeViewModel(
  plugins: PluginMarketSkillItem[],
  runtimeStatuses: RuntimeStatusRecord,
): PluginRuntimeViewModel {
  const runtimeStatusItems = Object.values(runtimeStatuses)
  const runtimeStatusByPluginId: Record<string, LocalSkillRuntimeStatus> = {}
  const matchedRuntimeSkillIds = new Set<string>()

  const userVisiblePlugins = plugins
    .filter(isUserVisiblePlugin)
    .map((plugin) => {
      const runtimeStatus = findMatchingRuntimeStatus(plugin, runtimeStatusItems)
      if (!runtimeStatus) {
        return plugin
      }

      runtimeStatusByPluginId[plugin.id] = runtimeStatus
      matchedRuntimeSkillIds.add(runtimeStatus.skill_id)

      if (plugin.installed) {
        return plugin
      }

      return {
        ...plugin,
        installed: true,
      }
    })

  const installedPlugins = userVisiblePlugins.filter((plugin) => plugin.installed)

  for (const runtimeStatus of runtimeStatusItems) {
    if (matchedRuntimeSkillIds.has(runtimeStatus.skill_id) || isOfficialLocalSkillId(runtimeStatus.skill_id)) {
      continue
    }

    const runtimePlugin = buildRuntimeOnlyPlugin(runtimeStatus)
    runtimeStatusByPluginId[runtimePlugin.id] = runtimeStatus
    installedPlugins.push(runtimePlugin)
  }

  return {
    userVisiblePlugins,
    installedPlugins,
    runtimeStatusByPluginId,
  }
}
