import { create } from "zustand"

export interface PendingApproval {
  approval_token: string
  tool_name: string
  arguments: any
  description?: string
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
