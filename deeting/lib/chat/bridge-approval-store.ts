import { create } from "zustand"

export interface PendingApproval {
  approval_token: string
  tool_name: string
  arguments: Record<string, unknown>
  description?: string
  risk_level?: string
  risk_reasons?: string[]
  expires_in_ms?: number
  meta: {
    call_id: string
    execution_token?: string
  }
}

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
