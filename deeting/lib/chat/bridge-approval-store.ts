import { create } from "zustand"

export interface BasePendingApproval {
  kind: "bridge_mcp"
  approval_token: string
  tool_id?: string
  tool_name: string
  arguments: Record<string, unknown>
  description?: string
  risk_level?: string
  risk_reasons?: string[]
  expires_in_ms?: number
}

export interface BridgeToolPendingApproval extends BasePendingApproval {
  kind: "bridge_mcp"
  meta: {
    call_id: string
    execution_token?: string
    message_id?: string
  }
}

export type PendingApproval = BridgeToolPendingApproval

export interface RecentApprovedExecution {
  call_id: string
  tool_name: string
  message_id?: string
  approved_at: number
}

interface BridgeApprovalState {
  pending: PendingApproval | null
  isApproving: boolean
  recentApprovedExecution: RecentApprovedExecution | null
  setPending: (approval: PendingApproval | null) => void
  setApproving: (approving: boolean) => void
  setRecentApprovedExecution: (execution: RecentApprovedExecution | null) => void
  clearRecentApprovedExecution: () => void
  clear: () => void
}

export const useBridgeApprovalStore = create<BridgeApprovalState>((set) => ({
  pending: null,
  isApproving: false,
  recentApprovedExecution: null,
  setPending: (approval) => set({ pending: approval }),
  setApproving: (approving) => set({ isApproving: approving }),
  setRecentApprovedExecution: (execution) => set({ recentApprovedExecution: execution }),
  clearRecentApprovedExecution: () => {
    if (recentApprovedExecutionTimer) {
      clearTimeout(recentApprovedExecutionTimer)
      recentApprovedExecutionTimer = null
    }
    set({ recentApprovedExecution: null })
  },
  clear: () => set({ pending: null, isApproving: false }),
}))

let recentApprovedExecutionTimer: ReturnType<typeof setTimeout> | null = null

export function createBridgeToolApproval(
  approval: Omit<BridgeToolPendingApproval, "kind">
): BridgeToolPendingApproval {
  return {
    kind: "bridge_mcp",
    ...approval,
  }
}

export function isBridgeToolApproval(
  approval: PendingApproval
): approval is BridgeToolPendingApproval {
  return approval.kind === "bridge_mcp"
}

export function announceBridgeApprovalExecution(approval: BridgeToolPendingApproval) {
  const execution: RecentApprovedExecution = {
    call_id: approval.meta.call_id,
    tool_name: approval.tool_name,
    message_id: approval.meta.message_id,
    approved_at: Date.now(),
  }

  if (recentApprovedExecutionTimer) {
    clearTimeout(recentApprovedExecutionTimer)
    recentApprovedExecutionTimer = null
  }

  useBridgeApprovalStore.getState().setRecentApprovedExecution(execution)

  recentApprovedExecutionTimer = setTimeout(() => {
    const current = useBridgeApprovalStore.getState().recentApprovedExecution
    if (
      current?.call_id === execution.call_id &&
      current.approved_at === execution.approved_at
    ) {
      useBridgeApprovalStore.getState().clearRecentApprovedExecution()
    }
  }, 2400)
}
