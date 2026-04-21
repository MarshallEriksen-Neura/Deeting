import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { McpServerCreateRequest } from "@/lib/api/mcp";
import { DESKTOP_MCP_COMMANDS } from "@/lib/api/mcp-desktop";
import { getMcpRegistryErrorNotification } from "./registry-notifications";

type McpTranslate = (key: string, values?: Record<string, string | number>) => string;
type McpRegistryAddNotification = (
  notification: ReturnType<typeof getMcpRegistryErrorNotification>
) => void;

interface UseMcpRegistryImportActionOptions {
  t: McpTranslate;
  addNotification: McpRegistryAddNotification;
  refreshAll: () => Promise<void>;
}

type McpRegistryImportParseResult =
  | {
      kind: "invalid";
      reasonKey:
        | "addServer.errors.missingMcpServers"
        | "addServer.errors.emptyMcpServers"
        | "addServer.errors.serverConfigNotObject"
        | "addServer.errors.missingRemoteUrl"
        | "addServer.errors.missingCommandOrUrl";
      values?: Record<string, string | number>;
    }
  | { kind: "ok"; requests: McpServerCreateRequest[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const buildInvalidImportConfigResult = (
  reasonKey: McpRegistryImportParseResult extends infer T
    ? T extends { kind: "invalid"; reasonKey: infer K }
      ? K
      : never
    : never,
  values?: Record<string, string | number>
): Extract<McpRegistryImportParseResult, { kind: "invalid" }> => ({
  kind: "invalid",
  reasonKey,
  values,
});

const normalizeRemoteServerType = (
  type: unknown
): "sse" | "streamable-http" | null => {
  if (typeof type !== "string") return null;

  const normalized = type.trim().toLowerCase();
  if (normalized === "sse") return "sse";
  if (
    normalized === "streamable-http" ||
    normalized === "streamable_http" ||
    normalized === "http"
  ) {
    return "streamable-http";
  }

  return null;
};

const toImportRequest = (
  name: string,
  config: unknown
): McpServerCreateRequest | null => {
  if (!isRecord(config)) return null;

  const command = typeof config.command === "string" ? config.command : undefined;
  const serviceKey =
    typeof config.service_key === "string" && config.service_key.trim().length > 0
      ? config.service_key.trim()
      : name;
  const serviceDisplayName =
    typeof config.service_display_name === "string" &&
    config.service_display_name.trim().length > 0
      ? config.service_display_name.trim()
      : undefined;
  const serviceDescription =
    typeof config.service_description === "string" &&
    config.service_description.trim().length > 0
      ? config.service_description.trim()
      : undefined;
  const args = Array.isArray(config.args)
    ? config.args.filter((item): item is string => typeof item === "string")
    : [];
  const envRaw = isRecord(config.env) ? config.env : {};
  const env = Object.keys(envRaw).reduce<Record<string, string>>((acc, key) => {
    acc[key] = "";
    return acc;
  }, {});
  const sseUrl =
    typeof config.sse_url === "string"
      ? config.sse_url
      : typeof config.url === "string"
        ? config.url
        : undefined;
  const displayName = typeof config.name === "string" ? config.name : name;
  const remoteServerType = normalizeRemoteServerType(config.type);

  if (sseUrl) {
    return {
      name: serviceDisplayName || displayName,
      description: serviceDescription ?? undefined,
      server_type: remoteServerType ?? "sse",
      sse_url: sseUrl,
      auth_type: "none",
      is_enabled: true,
    };
  }

  if (command) {
    return {
      name: serviceDisplayName || displayName,
      description: serviceDescription ?? undefined,
      server_type: "stdio",
      is_enabled: false,
      draft_config: {
        service_key: serviceKey,
        service_display_name: serviceDisplayName,
        service_description: serviceDescription,
        command,
        args,
        env,
      },
    };
  }

  return null;
};

export const parseMcpRegistryImportConfig = (
  config: Record<string, unknown>
): McpRegistryImportParseResult => {
  const rawServers = config.mcpServers;
  if (!isRecord(rawServers)) {
    return buildInvalidImportConfigResult("addServer.errors.missingMcpServers");
  }

  const serverEntries = Object.entries(rawServers);
  if (serverEntries.length === 0) {
    return buildInvalidImportConfigResult("addServer.errors.emptyMcpServers");
  }

  let firstInvalid: Extract<McpRegistryImportParseResult, { kind: "invalid" }> | null =
    null;

  const requests = serverEntries.reduce<McpServerCreateRequest[]>(
    (acc, [name, serverConfig]) => {
      const request = toImportRequest(name, serverConfig);
      if (request) {
        acc.push(request);
        return acc;
      }

      if (!firstInvalid) {
        if (!isRecord(serverConfig)) {
          firstInvalid = buildInvalidImportConfigResult(
            "addServer.errors.serverConfigNotObject",
            {
              name,
            }
          );
          return acc;
        }

        if (normalizeRemoteServerType(serverConfig.type)) {
          firstInvalid = buildInvalidImportConfigResult(
            "addServer.errors.missingRemoteUrl",
            {
              name,
            }
          );
          return acc;
        }

        firstInvalid = buildInvalidImportConfigResult(
          "addServer.errors.missingCommandOrUrl",
          {
            name,
          }
        );
      }

      return acc;
    },
    []
  );

  if (requests.length === 0) {
    return (
      firstInvalid ?? buildInvalidImportConfigResult("addServer.errors.emptyMcpServers")
    );
  }

  return { kind: "ok", requests };
};

export function useMcpRegistryImportAction({
  t,
  addNotification,
  refreshAll,
}: UseMcpRegistryImportActionOptions) {
  const handleImportConfig = useCallback(
    async (payload: { config: Record<string, unknown> }) => {
      const parsed = parseMcpRegistryImportConfig(payload.config);
      if (parsed.kind !== "ok") {
        addNotification({
          ...getMcpRegistryErrorNotification(
            t,
            "save",
            t(parsed.reasonKey, parsed.values),
            "warning"
          ),
          description: t(parsed.reasonKey, parsed.values),
        });
        return false;
      }

      try {
        await invoke(DESKTOP_MCP_COMMANDS.importConfig, { payload });
        await refreshAll();
        return true;
      } catch (err) {
        addNotification(getMcpRegistryErrorNotification(t, "save", err));
        return false;
      }
    },
    [addNotification, refreshAll, t]
  );

  return {
    handleImportConfig,
  };
}
