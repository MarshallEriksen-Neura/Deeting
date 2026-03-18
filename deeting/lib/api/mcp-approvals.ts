"use client"

import { invoke } from "@tauri-apps/api/core"
import { DESKTOP_MCP_COMMANDS } from "@/lib/api/mcp-desktop"
import type { PendingToolApprovalSnapshot } from "@/lib/chat/tool-approval"

export async function listPendingMcpApprovals(
  sessionId: string
): Promise<PendingToolApprovalSnapshot[]> {
  const result = await invoke<unknown>(DESKTOP_MCP_COMMANDS.listPendingApprovals, {
    sessionId,
  })

  return Array.isArray(result)
    ? (result.filter(
        (item): item is PendingToolApprovalSnapshot =>
          Boolean(item && typeof item === "object" && !Array.isArray(item))
      ) as PendingToolApprovalSnapshot[])
    : []
}
