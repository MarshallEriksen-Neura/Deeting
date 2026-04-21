import { useCallback, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { McpSourceCreateRequest } from "@/lib/api/mcp";
import { DESKTOP_MCP_COMMANDS } from "@/lib/api/mcp-desktop";
import { mapMcpSourceRecordToSource } from "@/lib/mcp/registry-mappers";
import { patchMcpSourceStatus, upsertMcpSource } from "@/lib/mcp/registry-patches";
import type { MCPSource, McpSourceRecord } from "@/types/mcp";
import {
  getMcpRegistryErrorNotification,
  getMcpRegistryNotification,
} from "./registry-notifications";

type McpTranslate = (key: string, values?: Record<string, string | number>) => string;
type McpRegistryAddNotification = (
  notification: ReturnType<typeof getMcpRegistryNotification>
) => void;

interface UseMcpRegistrySourceActionsOptions {
  t: McpTranslate;
  addNotification: McpRegistryAddNotification;
  sourceTokens: Readonly<Record<string, string>>;
  refreshAll: () => Promise<void>;
  updateSourceList: (updater: (sources: MCPSource[]) => MCPSource[]) => void;
  setSourceTokens: Dispatch<SetStateAction<Record<string, string>>>;
}

export interface McpRegistrySourceActionInput {
  name: string;
  sourceType: MCPSource["type"];
  pathOrUrl: string;
  trustLevel: MCPSource["trustLevel"];
  authToken?: string;
}

export const getMcpRegistrySourceSyncPayload = (authToken?: string) => ({
  auth_token: authToken || null,
});

export const getMcpRegistrySourceCreateRequest = (
  input: McpRegistrySourceActionInput
): McpSourceCreateRequest => ({
  name: input.name,
  source_type: input.sourceType,
  path_or_url: input.pathOrUrl,
  trust_level: input.trustLevel,
});

export const getDesktopMcpRegistrySourceCreatePayload = (
  input: McpRegistrySourceActionInput
): McpSourceCreateRequest & { is_read_only: boolean } => ({
  ...getMcpRegistrySourceCreateRequest(input),
  is_read_only: input.sourceType !== "local",
});

export const shouldSyncCreatedMcpSource = (input: McpRegistrySourceActionInput) =>
  Boolean(input.authToken);

export function useMcpRegistrySourceActions({
  t,
  addNotification,
  sourceTokens,
  refreshAll,
  updateSourceList,
  setSourceTokens,
}: UseMcpRegistrySourceActionsOptions) {
  const handleSyncSource = useCallback(
    async (source: MCPSource) => {
      updateSourceList((prev) => patchMcpSourceStatus(prev, source.id, "syncing"));

      try {
        await invoke(DESKTOP_MCP_COMMANDS.syncSource, {
          sourceId: source.id,
          payload: getMcpRegistrySourceSyncPayload(sourceTokens[source.id]),
        });
        await refreshAll();
      } catch (err) {
        addNotification(getMcpRegistryErrorNotification(t, "sync", err));
        void refreshAll();
      }
    },
    [addNotification, refreshAll, sourceTokens, t, updateSourceList]
  );

  const handleCreateSource = useCallback(
    async (payload: McpRegistrySourceActionInput) => {
      try {
        const created = await invoke<McpSourceRecord>(DESKTOP_MCP_COMMANDS.createSource, {
          payload: getDesktopMcpRegistrySourceCreatePayload(payload),
        });

        updateSourceList((prev) =>
          upsertMcpSource(prev, mapMcpSourceRecordToSource(created))
        );

        if (shouldSyncCreatedMcpSource(payload)) {
          setSourceTokens((prev) => ({ ...prev, [created.id]: payload.authToken || "" }));
          await invoke(DESKTOP_MCP_COMMANDS.syncSource, {
            sourceId: created.id,
            payload: getMcpRegistrySourceSyncPayload(payload.authToken),
          });
          await refreshAll();
        }
      } catch (err) {
        addNotification(getMcpRegistryErrorNotification(t, "sync", err));
      }
    },
    [addNotification, refreshAll, setSourceTokens, t, updateSourceList]
  );

  return {
    handleCreateSource,
    handleSyncSource,
  };
}
