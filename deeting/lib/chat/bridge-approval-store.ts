import { create } from "zustand"

export interface BasePendingApproval {
  kind: "bridge_mcp" | "local_code_mode"
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
  }
}

export interface InvokeApprovalAction {
  command: string
  args?: Record<string, unknown>
}

export interface LocalCodeModePendingApproval extends BasePendingApproval {
  kind: "local_code_mode"
  meta: {
    assistant_message_id: string
    call_id: string
    approve_action: InvokeApprovalAction
    reject_action?: InvokeApprovalAction
  }
}

export type PendingApproval =
  | BridgeToolPendingApproval
  | LocalCodeModePendingApproval

interface BridgeApprovalState {
  pending: PendingApproval | null
  isApproving: boolean
  setPending: (approval: PendingApproval | null) => void
  setApproving: (approving: boolean) => void
  clear: () => void
}

export const useBridgeApprovalStore = create<BridgeApprovalState>((set) => ({
  pending: null,
  isApproving: false,
  setPending: (approval) => set({ pending: approval }),
  setApproving: (approving) => set({ isApproving: approving }),
  clear: () => set({ pending: null, isApproving: false }),
}))

export function createBridgeToolApproval(
  approval: Omit<BridgeToolPendingApproval, "kind">
): BridgeToolPendingApproval {
  return {
    kind: "bridge_mcp",
    ...approval,
  }
}

export function createLocalCodeModeApproval(
  approval: Omit<LocalCodeModePendingApproval, "kind">
): LocalCodeModePendingApproval {
  return {
    kind: "local_code_mode",
    ...approval,
  }
}

export function isBridgeToolApproval(
  approval: PendingApproval
): approval is BridgeToolPendingApproval {
  return approval.kind === "bridge_mcp"
}
