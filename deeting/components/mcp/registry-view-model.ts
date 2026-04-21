import { useMemo } from "react";
import type { MCPSource, MCPTool } from "@/types/mcp";

export interface MCPRuntimeServerGroup {
  id: string;
  name: string;
  description: string;
  sourceType: MCPTool["source"];
  toolCount: number;
  conflictCount: number;
  runningCount: number;
  tools: MCPTool[];
  source?: MCPSource;
}

export const getMcpRegistryConflictCount = (tools: MCPTool[]): number =>
  tools.filter((tool) => tool.conflictStatus !== "none").length;

const GENERIC_SOURCE_NAMES = new Set(["local config", "cloud", "cloud source"]);

const GENERIC_COMMAND_NAMES = new Set([
  "npx",
  "bunx",
  "uvx",
  "python",
  "python3",
  "node",
  "cmd",
  "cmd.exe",
  "powershell",
  "powershell.exe",
  "pwsh",
  "pwsh.exe",
  "docker",
]);

const isRuntimeTransitioning = (tool: MCPTool) =>
  tool.status === "starting" || tool.status === "updating";

const isRuntimeLive = (tool: MCPTool) =>
  tool.runtimeReady ?? (tool.status === "healthy" || tool.status === "degraded");

const isToolRunningForUi = (tool: MCPTool) => {
  if (tool.desiredEnabled === false) {
    return false;
  }
  return isRuntimeLive(tool) || isRuntimeTransitioning(tool);
};

const toDisplayLabel = (value: string): string =>
  value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const sanitizeServiceToken = (value: string | undefined | null): string | null => {
  if (!value) return null;

  let candidate = value.trim().toLowerCase();
  if (!candidate) return null;

  candidate = candidate.replace(/\\/g, "/");
  if (candidate.includes("/")) {
    const segments = candidate.split("/").filter(Boolean);
    candidate = segments[segments.length - 1] ?? candidate;
  }

  candidate = candidate.replace(/\.(cmd|exe|ps1|py|js|mjs|cjs)$/g, "");
  candidate = candidate.replace(/^@[^/]+\//, "");
  candidate = candidate.replace(/^server[-_]/, "");
  candidate = candidate.replace(/^mcp[-_]/, "");
  candidate = candidate.replace(/[-_]mcp$/, "");
  candidate = candidate.replace(/^official\.skills\./, "");
  candidate = candidate.replace(/^official_skills_/, "");

  if (!candidate || candidate.startsWith("-") || GENERIC_COMMAND_NAMES.has(candidate)) {
    return null;
  }

  return candidate;
};

const deriveToolFamilyFromName = (tool: MCPTool): string | null => {
  const candidate = tool.identifier || tool.name;
  const match = candidate.match(/^([a-z0-9]+)[_-]/i);
  return match ? sanitizeServiceToken(match[1]) : null;
};

const deriveServiceIdentity = (
  tool: MCPTool,
  source?: MCPSource
): { key: string; label: string; description: string } => {
  if (tool.serviceKey && tool.serviceDisplayName) {
    return {
      key: `service:${tool.serviceKey}`,
      label: tool.serviceDisplayName,
      description: tool.serviceDescription || tool.description || source?.pathOrUrl || "",
    };
  }

  const normalizedSourceName = source?.name.trim().toLowerCase();
  if (normalizedSourceName && !GENERIC_SOURCE_NAMES.has(normalizedSourceName)) {
    return {
      key: `source:${normalizedSourceName}`,
      label: source?.name.trim() || toDisplayLabel(normalizedSourceName),
      description: source?.pathOrUrl || tool.description || "",
    };
  }

  const commandFamily = sanitizeServiceToken(tool.command);
  if (commandFamily) {
    return {
      key: `family:${commandFamily}`,
      label: toDisplayLabel(commandFamily),
      description: tool.description || source?.pathOrUrl || "",
    };
  }

  for (const arg of tool.args ?? []) {
    const argFamily = sanitizeServiceToken(arg);
    if (argFamily) {
      return {
        key: `family:${argFamily}`,
        label: toDisplayLabel(argFamily),
        description: tool.description || source?.pathOrUrl || "",
      };
    }
  }

  const nameFamily = deriveToolFamilyFromName(tool);
  if (nameFamily) {
    return {
      key: `family:${nameFamily}`,
      label: toDisplayLabel(nameFamily),
      description: tool.description || source?.pathOrUrl || "",
    };
  }

  if (tool.source === "url") {
    return {
      key: tool.sourceId ? `source:${tool.sourceId}` : `tool:${tool.id}`,
      label: tool.sourceId ? `Remote MCP ${tool.sourceId}` : "Remote MCP",
      description: source?.pathOrUrl || tool.description || "",
    };
  }

  return {
    key: tool.sourceId ? `source:${tool.sourceId}` : `tool:${tool.id}`,
    label: tool.sourceId ? `Local MCP ${tool.sourceId}` : tool.name,
    description: source?.pathOrUrl || tool.description || "",
  };
};

export const getMcpRegistryRuntimeGroups = ({
  tools,
  sources,
}: {
  tools: MCPTool[];
  sources: MCPSource[];
}): MCPRuntimeServerGroup[] => {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const groups = new Map<string, MCPRuntimeServerGroup>();

  tools.forEach((tool) => {
    const source = tool.sourceId ? sourceById.get(tool.sourceId) : undefined;
    const service = deriveServiceIdentity(tool, source);
    const groupId = service.key;
    const existing = groups.get(groupId);

    if (existing) {
      existing.tools.push(tool);
      existing.toolCount += 1;
      if (tool.conflictStatus !== "none") existing.conflictCount += 1;
      if (isToolRunningForUi(tool)) existing.runningCount += 1;
      return;
    }

    groups.set(groupId, {
      id: groupId,
      name: service.label,
      description: service.description,
      sourceType: tool.source,
      toolCount: 1,
      conflictCount: tool.conflictStatus !== "none" ? 1 : 0,
      runningCount: isToolRunningForUi(tool) ? 1 : 0,
      tools: [tool],
      source,
    });
  });

  return Array.from(groups.values()).sort((left, right) => {
    return (
      right.runningCount - left.runningCount ||
      right.toolCount - left.toolCount ||
      left.name.localeCompare(right.name)
    );
  });
};

export function useMcpRegistryViewModel({
  sources,
  tools,
}: {
  sources: MCPSource[];
  tools: MCPTool[];
}) {
  const runtimeGroups = useMemo(
    () => getMcpRegistryRuntimeGroups({ tools, sources }),
    [sources, tools]
  );
  const conflictCount = useMemo(() => getMcpRegistryConflictCount(tools), [tools]);

  return {
    conflictCount,
    runtimeGroups,
  };
}
