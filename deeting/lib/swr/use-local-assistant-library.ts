import useSWR from "swr"

import {
  type AssistantInstallPage,
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

type LocalAssistantLibraryLogger = Pick<Console, "warn">

const EMPTY_INSTALL_PAGE: AssistantInstallPage = {
  items: [],
  next_page: null,
  previous_page: null,
}

function resolveLocalAssistantLibraryPart<T>(
  result: PromiseSettledResult<T>,
  fallback: T,
  logger: LocalAssistantLibraryLogger,
  label: string
): T {
  if (result.status === "fulfilled") {
    return result.value
  }
  logger.warn(label, result.reason)
  return fallback
}

export async function fetchLocalAssistantLibrary(options?: {
  installPageSize?: number
  logger?: LocalAssistantLibraryLogger
}): Promise<LocalAssistantLibraryItem[]> {
  const logger = options?.logger ?? console
  const assistants = await listLocalAssistants()
  const [entitiesResult, versionsResult, installsResult] = await Promise.allSettled([
    listLocalAssistantEntities(),
    listLocalAssistantVersions(),
    listLocalAssistantInstallations({ size: options?.installPageSize ?? 200 }),
  ])

  // Assistant rows are the primary source for this page; metadata failures should not blank the list.
  const entities = resolveLocalAssistantLibraryPart<LocalAssistantEntity[]>(
    entitiesResult,
    [],
    logger,
    "local_assistant_library_entities_load_failed"
  )
  const versions = resolveLocalAssistantLibraryPart<LocalAssistantVersion[]>(
    versionsResult,
    [],
    logger,
    "local_assistant_library_versions_load_failed"
  )
  const installs = resolveLocalAssistantLibraryPart<AssistantInstallPage>(
    installsResult,
    EMPTY_INSTALL_PAGE,
    logger,
    "local_assistant_library_installs_load_failed"
  )

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
}

export function useLocalAssistantLibrary(enabled = true) {
  const { data, error, isLoading, mutate } = useSWR<
    LocalAssistantLibraryItem[],
    Error
  >(
    enabled ? "local-assistant-library" : null,
    () => fetchLocalAssistantLibrary(),
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
