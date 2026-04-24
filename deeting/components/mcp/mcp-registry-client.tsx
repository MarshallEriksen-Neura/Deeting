"use client";

import { useCallback, useState } from "react";
import dynamic from "next/dynamic";
import { invoke } from "@tauri-apps/api/core";
import { useTranslations } from "next-intl";
import { mapDesktopToolRecordToTool } from "@/lib/mcp/registry-mappers";
import { DESKTOP_MCP_COMMANDS } from "@/lib/api/mcp-desktop";
import { Skeleton } from "@/components/ui/shadcn/skeleton";
import { useNotifications } from "@/components/contexts/notification-context";
import type { MCPLogEntry, MCPSource, MCPTool, McpToolRecord } from "@/types/mcp";
import {
  useMcpRegistryClearLogsAction,
  useMcpRegistryHydration,
  useMcpRegistryIndexProgress,
  useMcpRegistryRefreshAll,
  useMcpRegistryToolLogs,
  type McpToolIndexProgressEvent,
} from "./registry-effects";
import { useMcpRegistryImportAction } from "./registry-import";
import { getMcpRegistryErrorNotification } from "./registry-notifications";
import { RegistryHeader } from "./registry-header";
import { useMcpRegistrySourceActions } from "./registry-source-actions";
import { useMcpRegistryToolActions } from "./registry-tool-actions";
import { useMcpRegistryViewModel } from "./registry-view-model";

const ServerLogsSheet = dynamic(
  () => import("./server-logs-sheet").then((mod) => mod.ServerLogsSheet),
  { ssr: false }
);
const ConflictResolutionDialog = dynamic(
  () =>
    import("./conflict-resolution-dialog").then((mod) => mod.ConflictResolutionDialog),
  { ssr: false }
);
const SupplyChainSection = dynamic(
  () => import("./supply-chain-section").then((mod) => mod.SupplyChainSection),
  { loading: () => <McpSectionSkeleton cardCount={3} columnsClassName="md:grid-cols-3" /> }
);
const RuntimeServerListSection = dynamic(
  () =>
    import("./runtime-server-list-section").then((mod) => mod.RuntimeServerListSection),
  {
    loading: () => <McpSectionSkeleton cardCount={4} columnsClassName="grid-cols-1" />,
  }
);

interface MCPRegistryClientProps {
  initialTools?: MCPTool[];
  initialSources?: MCPSource[];
}

const MAX_LOG_LINES = 1000;

export function MCPRegistryClient({
  initialTools = [],
  initialSources = [],
}: MCPRegistryClientProps) {
  const t = useTranslations("mcp");
  const { addNotification } = useNotifications();

  const [tools, setTools] = useState<MCPTool[]>(initialTools);
  const [sources, setSources] = useState<MCPSource[]>(initialSources);
  const [logsByTool, setLogsByTool] = useState<Record<string, MCPLogEntry[]>>({});
  const [selectedTool, setSelectedTool] = useState<MCPTool | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);
  const [conflictTool, setConflictTool] = useState<MCPTool | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [sourceTokens, setSourceTokens] = useState<Record<string, string>>({});
  const [reindexingMissingTools, setReindexingMissingTools] = useState(false);
  const [indexProgress, setIndexProgress] = useState<McpToolIndexProgressEvent | null>(
    null
  );

  const mapTool = useCallback(
    (tool: McpToolRecord): MCPTool =>
      mapDesktopToolRecordToTool(tool, t("conflict.warningDescription")),
    [t]
  );

  const { runtimeGroups, conflictCount } = useMcpRegistryViewModel({
    sources,
    tools,
  });

  const handleLoadError = useCallback(
    (error: unknown) => {
      addNotification(getMcpRegistryErrorNotification(t, "load", error));
    },
    [addNotification, t]
  );

  const refreshAll = useMcpRegistryRefreshAll({
    setSources,
    setTools,
    mapTool,
    onLoadError: handleLoadError,
  });

  useMcpRegistryHydration({
    tools,
    selectedTool,
    setSelectedTool,
    refreshAll,
  });

  useMcpRegistryToolLogs({
    logsOpen,
    selectedToolId: selectedTool?.id ?? null,
    setLogsByTool,
    onLoadError: handleLoadError,
    maxLogLines: MAX_LOG_LINES,
  });

  useMcpRegistryIndexProgress({
    onProgress: setIndexProgress,
    onCompleted: () => {
      void refreshAll();
      setTimeout(() => setIndexProgress(null), 1200);
    },
  });

  const updateToolList = useCallback((updater: (tools: MCPTool[]) => MCPTool[]) => {
    setTools((prev) => updater(prev));
  }, []);

  const updateSourceList = useCallback(
    (updater: (sources: MCPSource[]) => MCPSource[]) => {
      setSources((prev) => updater(prev));
    },
    []
  );

  const handleClearLogs = useMcpRegistryClearLogsAction({ setLogsByTool });

  const { handleCreateSource, handleSyncSource } = useMcpRegistrySourceActions({
    t,
    addNotification,
    sourceTokens,
    refreshAll,
    updateSourceList,
    setSourceTokens,
  });

  const { handleImportConfig } = useMcpRegistryImportAction({
    t,
    addNotification,
    refreshAll,
  });

  const {
    handleConflictOpenChange,
    handleDeleteTool,
    handleOpenConflict,
    handlePrimaryAction,
    handleResolveConflict,
    handleToggleTool,
  } = useMcpRegistryToolActions({
    t,
    addNotification,
    conflictTool,
    refreshAll,
    mapTool,
    updateToolList,
    setSelectedTool,
    setLogsOpen,
    setConflictTool,
    setConflictOpen,
  });

  const handleReindexMissingTools = useCallback(
    async (groupTools: MCPTool[]) => {
      if (groupTools.length === 0) {
        return;
      }

      setReindexingMissingTools(true);
      try {
        let successCount = 0;
        const failedToolNames: string[] = [];

        for (const tool of groupTools) {
          try {
            await invoke<void>(DESKTOP_MCP_COMMANDS.reindexTool, { toolId: tool.id });
            successCount += 1;
          } catch (error) {
            failedToolNames.push(tool.name);
            console.warn("[mcp] failed to reindex tool", tool.id, error);
          }
        }

        await refreshAll();

        if (successCount > 0) {
          addNotification({
            type: failedToolNames.length > 0 ? "warning" : "success",
            title: t(
              failedToolNames.length > 0
                ? "toast.reindexMissingPartial"
                : "toast.reindexMissingSuccess"
            ),
            description:
              failedToolNames.length > 0
                ? t("toast.reindexMissingPartialDesc", {
                    successCount,
                    failedCount: failedToolNames.length,
                    failedTools: failedToolNames.join(", "),
                  })
                : t("toast.reindexMissingSuccessDesc", { count: successCount }),
            timestamp: Date.now(),
          });
        }

        if (successCount === 0 && failedToolNames.length > 0) {
          addNotification({
            type: "error",
            title: t("toast.reindexMissingFailed"),
            description: t("toast.reindexMissingFailedDesc", {
              count: failedToolNames.length,
              failedTools: failedToolNames.join(", "),
            }),
            timestamp: Date.now(),
          });
        }
      } catch (error) {
        addNotification(getMcpRegistryErrorNotification(t, "save", error));
        await refreshAll();
      } finally {
        setReindexingMissingTools(false);
      }
    },
    [addNotification, refreshAll, t]
  );

  const visibleSources = sources.filter((source) => source.type !== "cloud");

  return (
    <div className="relative min-h-0 w-full min-w-0 space-y-8">
      <RegistryHeader onCreateManual={handleImportConfig} />

      <SupplyChainSection
        sources={visibleSources}
        onSync={handleSyncSource}
        onCreateSource={handleCreateSource}
      />

      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <h2 className="ws-pane-title">{t("runtime.title")}</h2>
          <div className="h-px flex-1 bg-[var(--hairline)]" />
        </div>

        {indexProgress && indexProgress.total > 0 ? (
          <div className="rounded-[var(--r-12)] border border-[var(--info-border)] bg-[var(--info-soft)] p-3">
            <div className="mb-1 flex items-center justify-between text-[12px] text-[var(--info)]">
              <span>{t("actions.reindexingMissing")}</span>
              <span>
                {indexProgress.processed}/{indexProgress.total}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--panel-bg-inset)]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[var(--info)] to-[var(--accent-strong)] transition-all duration-300"
                style={{
                  width: `${
                    indexProgress.total > 0
                      ? Math.min(
                          100,
                          Math.round(
                            (indexProgress.processed / indexProgress.total) * 100
                          )
                        )
                      : 100
                  }%`,
                }}
              />
            </div>
            <div className="mt-1 text-[11px] text-[var(--info)] opacity-90">
              {indexProgress.phase === "completed"
                ? `${t("tool.labels.index")}: ${indexProgress.indexed}/${indexProgress.total}`
                : `${t("tool.labels.index")}: ${indexProgress.indexed}/${indexProgress.total}${
                    indexProgress.current ? ` - ${indexProgress.current}` : ""
                  }`}
            </div>
          </div>
        ) : null}

        <div className="ws-bezel">
          <div className="ws-bezel-inner p-4 sm:p-5">
            <RuntimeServerListSection
              groups={runtimeGroups}
              conflictCount={conflictCount}
              platform="desktop"
              toggleMode="runtime"
              onToggleTool={(tool, enabled) => handleToggleTool(tool, enabled)}
              onPrimaryAction={handlePrimaryAction}
              onResolveConflict={handleOpenConflict}
              onDeleteServer={handleDeleteTool}
              onReindexMissingTools={handleReindexMissingTools}
              reindexMissingLoading={reindexingMissingTools}
            />
          </div>
        </div>
      </section>

      <ServerLogsSheet
        tool={selectedTool}
        open={logsOpen}
        onOpenChange={setLogsOpen}
        logs={selectedTool ? logsByTool[selectedTool.id] || [] : []}
        onClear={() => {
          if (selectedTool) {
            void handleClearLogs(selectedTool);
          }
        }}
      />

      <ConflictResolutionDialog
        tool={conflictTool}
        open={conflictOpen}
        onOpenChange={handleConflictOpenChange}
        onResolve={handleResolveConflict}
      />
    </div>
  );
}

function McpSectionSkeleton({
  cardCount,
  columnsClassName,
}: {
  cardCount: number;
  columnsClassName: string;
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Skeleton className="h-4 w-32" />
        <div className="h-px flex-1 bg-[var(--hairline)]" />
      </div>

      <div className={`grid grid-cols-1 gap-4 ${columnsClassName}`}>
        {Array.from({ length: cardCount }).map((_, index) => (
          <div key={index} className="ws-bezel">
            <div className="ws-bezel-inner p-6">
              <div className="space-y-4">
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-28 w-full" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
