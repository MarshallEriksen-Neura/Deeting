import { act, renderHook } from "@testing-library/react"
import { invoke } from "@tauri-apps/api/core"

import { useMcpRegistryRefreshAll } from "@/components/mcp/registry-effects"
import { useMcpRegistryImportAction } from "@/components/mcp/registry-import"
import { useMcpRegistrySourceActions } from "@/components/mcp/registry-source-actions"
import { useMcpRegistryToolActions } from "@/components/mcp/registry-tool-actions"
import { DESKTOP_MCP_COMMANDS } from "@/lib/api/mcp-desktop"
import type { MCPTool, McpSourceRecord, McpToolRecord } from "@/types/mcp"

jest.mock("@tauri-apps/api/core", () => ({
  invoke: jest.fn(),
}))

const mockInvoke = invoke as jest.MockedFunction<typeof invoke>

const translate = (key: string) => key

const createSourceRecord = (id: string): McpSourceRecord => ({
  id,
  user_id: "user-1",
  name: "Demo Source",
  source_type: "local",
  path_or_url: "/tmp/demo.json",
  trust_level: "private",
  status: "active",
  last_synced_at: null,
  is_read_only: false,
  created_at: "2026-03-18T00:00:00Z",
  updated_at: "2026-03-18T00:00:00Z",
})

const createToolRecord = (id: string): McpToolRecord => ({
  id,
  identifier: null,
  name: "demo_tool",
  source_type: "local",
  source_id: "source-1",
  status: "healthy",
  ping_ms: null,
  capabilities: [],
  description: "demo",
  error: null,
  command: "python3",
  args: [],
  env: null,
  config_json: "{}",
  pending_config_json: null,
  config_hash: "hash",
  pending_config_hash: null,
  conflict_status: "none",
  is_read_only: false,
  is_new: false,
  created_at: "2026-03-18T00:00:00Z",
  updated_at: "2026-03-18T00:00:00Z",
  desired_enabled: true,
  runtime_ready: true,
  runtime_status_reason: "ready_in_local_runtime",
  availability_class: "callable_direct",
  recommended_action: "execute",
  activation_required: false,
  install_required: false,
  index_status: "indexed",
  index_status_reason: "indexed_in_local_memory",
})

describe("desktop MCP command contracts", () => {
  afterEach(() => {
    mockInvoke.mockReset()
    jest.clearAllMocks()
  })

  it("exports the stable desktop MCP command names used by the frontend", () => {
    expect(DESKTOP_MCP_COMMANDS.createSource).toBe("create_mcp_source")
    expect(DESKTOP_MCP_COMMANDS.syncSource).toBe("sync_mcp_source")
    expect(DESKTOP_MCP_COMMANDS.listSources).toBe("list_mcp_sources")
    expect(DESKTOP_MCP_COMMANDS.listTools).toBe("list_mcp_tools")
    expect(DESKTOP_MCP_COMMANDS.reindexTool).toBe("reindex_mcp_tool")
    expect(DESKTOP_MCP_COMMANDS.importConfig).toBe("import_mcp_config")
    expect(DESKTOP_MCP_COMMANDS.startTool).toBe("start_mcp_tool")
    expect(DESKTOP_MCP_COMMANDS.approveTool).toBe("approve_mcp_tool")
    expect(DESKTOP_MCP_COMMANDS.rejectTool).toBe("reject_mcp_tool")
  })

  it("uses the shared desktop command names for source create and sync", async () => {
    const refreshAll = jest.fn().mockResolvedValue(undefined)
    const updateSourceList = jest.fn()
    const setSourceTokens = jest.fn()

    mockInvoke
      .mockResolvedValueOnce(createSourceRecord("source-1") as never)
      .mockResolvedValueOnce([] as never)

    const { result } = renderHook(() =>
      useMcpRegistrySourceActions({
        isTauri: true,
        t: translate,
        accessToken: null,
        addNotification: jest.fn(),
        sourceTokens: {},
        createSource: { trigger: jest.fn() },
        syncSource: { trigger: jest.fn() },
        refreshAll,
        updateSourceList,
        setSourceTokens,
      })
    )

    await act(async () => {
      await result.current.handleCreateSource({
        name: "Demo Source",
        sourceType: "local",
        pathOrUrl: "/tmp/demo.json",
        trustLevel: "private",
        authToken: "token-1",
      })
    })

    expect(mockInvoke).toHaveBeenNthCalledWith(1, DESKTOP_MCP_COMMANDS.createSource, {
      payload: {
        name: "Demo Source",
        source_type: "local",
        path_or_url: "/tmp/demo.json",
        trust_level: "private",
        is_read_only: false,
      },
    })
    expect(mockInvoke).toHaveBeenNthCalledWith(2, DESKTOP_MCP_COMMANDS.syncSource, {
      sourceId: "source-1",
      payload: { auth_token: "token-1" },
    })
  })

  it("uses the shared desktop list command names during Tauri registry refresh", async () => {
    const refreshSources = jest.fn()
    const refreshServers = jest.fn()
    const refreshTools = jest.fn().mockResolvedValue(undefined)
    const setSources = jest.fn()
    const setTools = jest.fn()

    mockInvoke
      .mockResolvedValueOnce([createSourceRecord("source-1")] as never)
      .mockResolvedValueOnce([createToolRecord("tool-1")] as never)

    const { result } = renderHook(() =>
      useMcpRegistryRefreshAll({
        isTauri: true,
        refreshSources,
        refreshServers,
        refreshTools,
        setSources,
        setTools,
        mapTool: jest.fn((tool: McpToolRecord) => tool as unknown as MCPTool),
        onLoadError: jest.fn(),
      })
    )

    await act(async () => {
      await result.current()
    })

    expect(mockInvoke).toHaveBeenNthCalledWith(1, DESKTOP_MCP_COMMANDS.listSources)
    expect(mockInvoke).toHaveBeenNthCalledWith(2, DESKTOP_MCP_COMMANDS.listTools)
    expect(setSources).toHaveBeenCalledTimes(1)
    expect(setTools).toHaveBeenCalledTimes(1)
  })

  it("uses the shared desktop import command name for local MCP config import", async () => {
    const refreshAll = jest.fn().mockResolvedValue(undefined)
    mockInvoke.mockResolvedValueOnce([] as never)

    const { result } = renderHook(() =>
      useMcpRegistryImportAction({
        isTauri: true,
        t: translate,
        addNotification: jest.fn(),
        createServer: { trigger: jest.fn() },
        syncServer: { trigger: jest.fn() },
        refreshAll,
      })
    )

    const payload = {
      config: {
        mcpServers: {
          demo: {
            command: "python3",
            args: ["demo.py"],
          },
        },
      },
    }

    await act(async () => {
      await result.current.handleImportConfig(payload)
    })

    expect(mockInvoke).toHaveBeenCalledWith(DESKTOP_MCP_COMMANDS.importConfig, { payload })
  })

  it("uses the shared desktop tool command names for local tool lifecycle actions", async () => {
    const refreshAll = jest.fn().mockResolvedValue(undefined)
    const updateToolList = jest.fn()

    mockInvoke.mockResolvedValue(undefined as never)

    const { result } = renderHook(() =>
      useMcpRegistryToolActions({
        isTauri: true,
        t: translate,
        addNotification: jest.fn(),
        conflictTool: null,
        refreshAll,
        refreshTools: jest.fn().mockResolvedValue(undefined),
        toolToggleMutation: { trigger: jest.fn() },
        mapTool: jest.fn((tool: McpToolRecord) => tool as unknown as MCPTool),
        mapServerTool: jest.fn((tool) => tool as unknown as MCPTool),
        updateToolList,
        handleOpenEditServer: jest.fn(),
        handleSyncServer: jest.fn().mockResolvedValue(undefined),
        handleToggleServerEnabled: jest.fn().mockResolvedValue(undefined),
        setSelectedTool: jest.fn(),
        setLogsOpen: jest.fn(),
        setConflictTool: jest.fn(),
        setConflictOpen: jest.fn(),
      })
    )

    await act(async () => {
      await result.current.handleToggleTool({ id: "tool-1", name: "demo_tool" } as MCPTool, true)
    })

    expect(mockInvoke).toHaveBeenCalledWith(DESKTOP_MCP_COMMANDS.startTool, { toolId: "tool-1" })
  })
})
