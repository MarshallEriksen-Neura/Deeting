"use client"

export const DESKTOP_MCP_COMMANDS = {
  listSources: "list_mcp_sources",
  createSource: "create_mcp_source",
  syncSource: "sync_mcp_source",
  syncCloudSubscriptions: "sync_cloud_subscriptions",
  listTools: "list_mcp_tools",
  deleteLocalTool: "delete_local_mcp_tool",
  importConfig: "import_mcp_config",
  startTool: "start_mcp_tool",
  stopTool: "stop_mcp_tool",
  executeToolRaw: "execute_mcp_tool_raw",
  listPendingApprovals: "list_pending_mcp_approvals",
  approveTool: "approve_mcp_tool",
  rejectTool: "reject_mcp_tool",
  resolveConflict: "resolve_mcp_conflict",
  getLogs: "get_mcp_logs",
  clearLogs: "clear_mcp_logs",
} as const

export type DesktopMcpCommandName =
  (typeof DESKTOP_MCP_COMMANDS)[keyof typeof DESKTOP_MCP_COMMANDS]
