import useSWR from "swr"

import {
  listLocalAssistantEntities,
  listLocalAssistantInstallations,
  listLocalAssistants,
  listLocalAssistantVersions,
  type LocalAssistant,
  type LocalAssistantEntity,
  type LocalAssistantVersion,
} from "@/lib/api/assistants"

export type LocalAssistantLibraryItem = {
  assistant: LocalAssistant
  entity?: LocalAssistantEntity
  version?: LocalAssistantVersion
  installed: boolean
}

export function useLocalAssistantLibrary(enabled = true) {
  const { data, error, isLoading, mutate } = useSWR<
    LocalAssistantLibraryItem[],
    Error
  >(
    enabled ? "local-assistant-library" : null,
    async () => {
      const [assistants, entities, versions, installs] = await Promise.all([
        listLocalAssistants(),
        listLocalAssistantEntities(),
        listLocalAssistantVersions(),
        listLocalAssistantInstallations({ size: 200 }),
      ])

      const entityMap = new Map<string, LocalAssistantEntity>()
      entities.forEach((entity) => {
        entityMap.set(entity.id, entity)
      })

      const versionMap = new Map<string, LocalAssistantVersion[]>()
      versions.forEach((version) => {
        const current = versionMap.get(version.assistant_id) ?? []
        current.push(version)
        versionMap.set(version.assistant_id, current)
      })

      const installedIds = new Set(installs.items.map((item) => item.assistant_id))

      return assistants
        .filter((assistant) => !assistant.is_deleted)
        .map((assistant) => {
          const assistantVersions = versionMap.get(assistant.id) ?? []
          const entity = entityMap.get(assistant.id)
          const version =
            assistantVersions.find((item) => item.id === entity?.current_version_id) ??
            assistantVersions[0]

          return {
            assistant,
            entity,
            version,
            installed: installedIds.has(assistant.id),
          }
        })
        .sort((left, right) =>
          right.assistant.updated_at.localeCompare(left.assistant.updated_at)
        )
    },
    {
      revalidateOnFocus: false,
    }
  )

  return {
    items: data ?? [],
    isLoading,
    error,
    mutate,
  }
}
