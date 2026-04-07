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
  recovered?: boolean
  recovery_reason?: string
  attempts?: number
  expires_in_ms?: number
}

export interface BridgeToolPendingApproval extends BasePendingApproval {
  kind: "bridge_mcp"
  meta: {
    call_id: string
    execution_token?: string
    message_id?: string
    execution_graph_execution_id?: string
    execution_graph_gate_node_id?: string
    execution_graph_tool_node_id?: string
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
  queue: PendingApproval[]
  pending: PendingApproval | null
  isApproving: boolean
  recentApprovedExecution: RecentApprovedExecution | null
  setPending: (approval: PendingApproval | null) => void
  enqueuePending: (approval: PendingApproval) => void
  replacePendingByToken: (approval: PendingApproval) => void
  focusPendingByToken: (approvalToken: string) => void
  setApproving: (approving: boolean) => void
  setRecentApprovedExecution: (execution: RecentApprovedExecution | null) => void
  clearRecentApprovedExecution: () => void
  clear: () => void
  clearAll: () => void
}

export const useBridgeApprovalStore = create<BridgeApprovalState>((set) => ({
  queue: [],
  pending: null,
  isApproving: false,
  recentApprovedExecution: null,
  setPending: (approval) =>
    set((state) => {
      if (!approval) {
        return { queue: [], pending: null }
      }
      const nextQueue = [...state.queue]
      const existingIndex = nextQueue.findIndex(
        (item) => item.approval_token === approval.approval_token
      )
      if (existingIndex >= 0) {
        nextQueue[existingIndex] = approval
      } else {
        nextQueue.push(approval)
      }
      return {
        queue: nextQueue,
        pending: nextQueue[0] ?? null,
      }
    }),
  enqueuePending: (approval) =>
    set((state) => {
      if (state.queue.some((item) => item.approval_token === approval.approval_token)) {
        return state
      }
      const nextQueue = [...state.queue, approval]
      return {
        queue: nextQueue,
        pending: nextQueue[0] ?? null,
      }
    }),
  replacePendingByToken: (approval) =>
    set((state) => {
      const nextQueue = state.queue.map((item) =>
        item.approval_token === approval.approval_token ? approval : item
      )
      return {
        queue: nextQueue,
        pending: nextQueue[0] ?? null,
      }
    }),
  focusPendingByToken: (approvalToken) =>
    set((state) => {
      const normalizedToken = approvalToken.trim()
      if (!normalizedToken) return state
      const index = state.queue.findIndex(
        (item) => item.approval_token === normalizedToken
      )
      if (index <= 0) return state
      const nextQueue = [...state.queue]
      const [selected] = nextQueue.splice(index, 1)
      nextQueue.unshift(selected)
      return {
        queue: nextQueue,
        pending: nextQueue[0] ?? null,
      }
    }),
  setApproving: (approving) => set({ isApproving: approving }),
  setRecentApprovedExecution: (execution) => set({ recentApprovedExecution: execution }),
  clearRecentApprovedExecution: () => {
    if (recentApprovedExecutionTimer) {
      clearTimeout(recentApprovedExecutionTimer)
      recentApprovedExecutionTimer = null
    }
    set({ recentApprovedExecution: null })
  },
  clear: () =>
    set((state) => {
      const nextQueue = state.queue.slice(1)
      return {
        queue: nextQueue,
        pending: nextQueue[0] ?? null,
        isApproving: false,
      }
    }),
  clearAll: () => set({ queue: [], pending: null, isApproving: false }),
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
