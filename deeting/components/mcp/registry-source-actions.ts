import { useCallback, type Dispatch, type SetStateAction } from "react"
import { invoke } from "@tauri-apps/api/core"

import type { McpSourceCreateRequest, McpSourceSyncRequest } from "@/lib/api/mcp"
import { mapMcpSourceRecordToSource } from "@/lib/mcp/registry-mappers"
import { patchMcpSourceStatus, upsertMcpSource } from "@/lib/mcp/registry-patches"
import type { MCPSource, McpSourceRecord } from "@/types/mcp"

import {
  getMcpRegistryErrorNotification,
  getMcpRegistryNotification,
} from "./registry-notifications"

type McpTranslate = (key: string, values?: Record<string, string | number>) => string
type McpRegistryAddNotification = (notification: ReturnType<typeof getMcpRegistryNotification>) => void

type McpRegistrySourceCreateMutation = {
  trigger: (payload: McpSourceCreateRequest) => Promise<{ id: string }>
}

type McpRegistrySourceSyncMutation = {
  trigger: (args: [string, McpSourceSyncRequest]) => Promise<unknown>
}

interface UseMcpRegistrySourceActionsOptions {
  isTauri: boolean
  t: McpTranslate
  accessToken: string | null
  addNotification: McpRegistryAddNotification
  sourceTokens: Readonly<Record<string, string>>
  createSource: McpRegistrySourceCreateMutation
  syncSource: McpRegistrySourceSyncMutation
  refreshAll: () => Promise<void>
  updateSourceList: (updater: (sources: MCPSource[]) => MCPSource[]) => void
  setSourceTokens: Dispatch<SetStateAction<Record<string, string>>>
}

export interface McpRegistrySourceActionInput {
  name: string
  sourceType: MCPSource["type"]
  pathOrUrl: string
  trustLevel: MCPSource["trustLevel"]
  authToken?: string
}

export const getMcpRegistrySourceSyncPayload = (authToken?: string): { auth_token: string | null } => ({
  auth_token: authToken || null,
})

export const getMcpRegistrySourceCreateRequest = (
  input: McpRegistrySourceActionInput
): McpSourceCreateRequest => ({
  name: input.name,
  source_type: input.sourceType,
  path_or_url: input.pathOrUrl,
  trust_level: input.trustLevel,
})

export const getDesktopMcpRegistrySourceCreatePayload = (
  input: McpRegistrySourceActionInput
): McpSourceCreateRequest & { is_read_only: boolean } => ({
  ...getMcpRegistrySourceCreateRequest(input),
  is_read_only: input.sourceType !== "local",
})

export const shouldSyncCreatedMcpSource = (input: McpRegistrySourceActionInput): boolean => {
  return Boolean(input.authToken)
}

export function useMcpRegistrySourceActions({
  isTauri,
  t,
  accessToken,
  addNotification,
  sourceTokens,
  createSource,
  syncSource,
  refreshAll,
  updateSourceList,
  setSourceTokens,
}: UseMcpRegistrySourceActionsOptions) {
  const handleSyncSource = useCallback(async (source: MCPSource) => {
    updateSourceList((prev) => patchMcpSourceStatus(prev, source.id, "syncing"))

    try {
      if (!isTauri) {
        await syncSource.trigger([source.id, getMcpRegistrySourceSyncPayload(sourceTokens[source.id])])
      } else if (source.type === "cloud") {
        if (!accessToken) {
          throw new Error(t("toast.missingToken"))
        }
        await invoke("sync_cloud_subscriptions", { accessToken })
      } else {
        await invoke("sync_mcp_source", {
          sourceId: source.id,
          payload: getMcpRegistrySourceSyncPayload(sourceTokens[source.id]),
        })
      }

      await refreshAll()
    } catch (err) {
      addNotification(getMcpRegistryErrorNotification(t, "sync", err))
      void refreshAll()
    }
  }, [accessToken, addNotification, isTauri, refreshAll, sourceTokens, syncSource, t, updateSourceList])

  const handleCreateSource = useCallback(async (payload: McpRegistrySourceActionInput) => {
    if (!isTauri) {
      try {
        const created = await createSource.trigger(getMcpRegistrySourceCreateRequest(payload))
        setSourceTokens((prev) => ({ ...prev, [created.id]: payload.authToken || "" }))
        await syncSource.trigger([created.id, getMcpRegistrySourceSyncPayload(payload.authToken)])
        await refreshAll()
      } catch (err) {
        addNotification(getMcpRegistryErrorNotification(t, "sync", err))
        void refreshAll()
      }
      return
    }

    try {
      const created = await invoke<McpSourceRecord>("create_mcp_source", {
        payload: getDesktopMcpRegistrySourceCreatePayload(payload),
      })
      updateSourceList((prev) => upsertMcpSource(prev, mapMcpSourceRecordToSource(created)))

      if (shouldSyncCreatedMcpSource(payload)) {
        setSourceTokens((prev) => ({ ...prev, [created.id]: payload.authToken || "" }))
        await invoke("sync_mcp_source", {
          sourceId: created.id,
          payload: getMcpRegistrySourceSyncPayload(payload.authToken),
        })
        await refreshAll()
      }
    } catch (err) {
      addNotification(getMcpRegistryErrorNotification(t, "sync", err))
    }
  }, [addNotification, createSource, isTauri, refreshAll, setSourceTokens, syncSource, t, updateSourceList])

  return {
    handleCreateSource,
    handleSyncSource,
  }
}