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

export type ApprovalMachinePhase =
  | "pending"
  | "executing"
  | "resolved"
  | "rejected"
  | "failed"

type ApprovalMachineSource = "message" | "canonical" | "manual"

interface ApprovalMachineNode {
  approval: PendingApproval
  phase: ApprovalMachinePhase
  source: ApprovalMachineSource
  updated_at: number
}

function normalizeApprovalToken(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : ""
}

function mergeApproval(
  current: PendingApproval | undefined,
  incoming: PendingApproval
): PendingApproval {
  if (!current) return incoming
  return {
    ...current,
    ...incoming,
    meta: {
      ...current.meta,
      ...incoming.meta,
    },
  }
}

function isTerminalPhase(phase: ApprovalMachinePhase) {
  return phase === "resolved" || phase === "rejected" || phase === "failed"
}

function upsertApprovalNode(
  approvalsByToken: Record<string, ApprovalMachineNode>,
  approvalOrder: string[],
  approval: PendingApproval,
  source: ApprovalMachineSource,
  phase: ApprovalMachinePhase = "pending"
) {
  const approvalToken = normalizeApprovalToken(approval.approval_token)
  if (!approvalToken) {
    return { approvalsByToken, approvalOrder }
  }

  const current = approvalsByToken[approvalToken]
  const nextPhase =
    current && current.phase === "executing" && phase === "pending"
      ? current.phase
      : phase

  const nextNode: ApprovalMachineNode = {
    approval: mergeApproval(current?.approval, approval),
    phase: nextPhase,
    source,
    updated_at: Date.now(),
  }

  const nextApprovalsByToken = {
    ...approvalsByToken,
    [approvalToken]: nextNode,
  }

  const alreadyOrdered = approvalOrder.includes(approvalToken)
  const shouldBeVisible = !isTerminalPhase(nextPhase) && nextPhase !== "executing"
  let nextApprovalOrder = approvalOrder

  if (shouldBeVisible && !alreadyOrdered) {
    nextApprovalOrder = [...approvalOrder, approvalToken]
  } else if (!shouldBeVisible && alreadyOrdered) {
    nextApprovalOrder = approvalOrder.filter((token) => token !== approvalToken)
  }

  return {
    approvalsByToken: nextApprovalsByToken,
    approvalOrder: nextApprovalOrder,
  }
}

function deriveVisibleQueue(
  approvalsByToken: Record<string, ApprovalMachineNode>,
  approvalOrder: string[],
  activeApprovalToken: string | null,
  isApproving: boolean
) {
  const visibleTokens = approvalOrder.filter((token) => {
    const node = approvalsByToken[token]
    return Boolean(node && node.phase === "pending")
  })

  const normalizedActiveToken = normalizeApprovalToken(activeApprovalToken)
  if (!isApproving || !normalizedActiveToken) {
    return visibleTokens
      .map((token) => approvalsByToken[token]?.approval)
      .filter((approval): approval is PendingApproval => Boolean(approval))
  }

  const activeNode = approvalsByToken[normalizedActiveToken]
  const activeApproval =
    activeNode && activeNode.phase === "pending" ? activeNode.approval : null
  const rest = visibleTokens
    .filter((token) => token !== normalizedActiveToken)
    .map((token) => approvalsByToken[token]?.approval)
    .filter((approval): approval is PendingApproval => Boolean(approval))

  return activeApproval ? [activeApproval, ...rest] : rest
}

function deriveProjection(
  approvalsByToken: Record<string, ApprovalMachineNode>,
  approvalOrder: string[],
  activeApprovalToken: string | null,
  isApproving: boolean
) {
  const queue = deriveVisibleQueue(
    approvalsByToken,
    approvalOrder,
    activeApprovalToken,
    isApproving
  )
  return {
    queue,
    pending: queue[0] ?? null,
    isApproving,
    activeApprovalToken,
  }
}

interface BridgeApprovalState {
  approvalsByToken: Record<string, ApprovalMachineNode>
  approvalOrder: string[]
  queue: PendingApproval[]
  pending: PendingApproval | null
  isApproving: boolean
  activeApprovalToken: string | null
  recentApprovedExecution: RecentApprovedExecution | null
  setPending: (approval: PendingApproval | null) => void
  enqueuePending: (approval: PendingApproval) => void
  replaceQueue: (approvals: PendingApproval[]) => void
  replacePendingByToken: (approval: PendingApproval) => void
  focusPendingByToken: (approvalToken: string) => void
  removePendingByToken: (approvalToken: string) => void
  setApproving: (approving: boolean) => void
  setRecentApprovedExecution: (execution: RecentApprovedExecution | null) => void
  clearRecentApprovedExecution: () => void
  clear: () => void
  clearAll: () => void
}

function emptyProjection() {
  return {
    approvalsByToken: {},
    approvalOrder: [],
    queue: [],
    pending: null,
    isApproving: false,
    activeApprovalToken: null,
  }
}

export const useBridgeApprovalStore = create<BridgeApprovalState>((set) => ({
  ...emptyProjection(),
  recentApprovedExecution: null,
  setPending: (approval) =>
    set((state) => {
      if (!approval) {
        return {
          ...state,
          ...emptyProjection(),
        }
      }

      const next = upsertApprovalNode(
        state.approvalsByToken,
        state.approvalOrder.filter(
          (token) => token !== normalizeApprovalToken(approval.approval_token)
        ),
        approval,
        "manual"
      )
      const nextOrder = [
        normalizeApprovalToken(approval.approval_token),
        ...next.approvalOrder,
      ].filter((token, index, list) => token && list.indexOf(token) === index)

      return {
        ...state,
        ...next,
        approvalOrder: nextOrder,
        ...deriveProjection(
          next.approvalsByToken,
          nextOrder,
          state.activeApprovalToken,
          state.isApproving
        ),
      }
    }),
  enqueuePending: (approval) =>
    set((state) => {
      const next = upsertApprovalNode(
        state.approvalsByToken,
        state.approvalOrder,
        approval,
        "message"
      )
      return {
        ...state,
        ...next,
        ...deriveProjection(
          next.approvalsByToken,
          next.approvalOrder,
          state.activeApprovalToken,
          state.isApproving
        ),
      }
    }),
  replaceQueue: (approvals) =>
    set((state) => {
      const nextApprovalsByToken: Record<string, ApprovalMachineNode> = {}
      let nextApprovalOrder: string[] = []

      for (const approval of approvals) {
        const next = upsertApprovalNode(
          nextApprovalsByToken,
          nextApprovalOrder,
          approval,
          "canonical"
        )
        Object.assign(nextApprovalsByToken, next.approvalsByToken)
        nextApprovalOrder = next.approvalOrder
      }

      const normalizedActiveToken = normalizeApprovalToken(state.activeApprovalToken)
      if (state.isApproving && normalizedActiveToken) {
        const activeNode = state.approvalsByToken[normalizedActiveToken]
        if (activeNode) {
          nextApprovalsByToken[normalizedActiveToken] = {
            ...activeNode,
            phase:
              activeNode.phase === "executing" ? "executing" : activeNode.phase,
          }
          nextApprovalOrder = nextApprovalOrder.filter(
            (token) => token !== normalizedActiveToken
          )
        }
      }

      return {
        ...state,
        approvalsByToken: nextApprovalsByToken,
        approvalOrder: nextApprovalOrder,
        ...deriveProjection(
          nextApprovalsByToken,
          nextApprovalOrder,
          state.activeApprovalToken,
          state.isApproving
        ),
      }
    }),
  replacePendingByToken: (approval) =>
    set((state) => {
      const source =
        state.approvalsByToken[normalizeApprovalToken(approval.approval_token)]?.source ??
        "manual"
      const next = upsertApprovalNode(
        state.approvalsByToken,
        state.approvalOrder,
        approval,
        source
      )
      return {
        ...state,
        ...next,
        ...deriveProjection(
          next.approvalsByToken,
          next.approvalOrder,
          state.activeApprovalToken,
          state.isApproving
        ),
      }
    }),
  focusPendingByToken: (approvalToken) =>
    set((state) => {
      const normalizedToken = normalizeApprovalToken(approvalToken)
      if (!normalizedToken || !state.approvalOrder.includes(normalizedToken)) {
        return state
      }

      const nextApprovalOrder = [
        normalizedToken,
        ...state.approvalOrder.filter((token) => token !== normalizedToken),
      ]

      return {
        ...state,
        approvalOrder: nextApprovalOrder,
        ...deriveProjection(
          state.approvalsByToken,
          nextApprovalOrder,
          state.activeApprovalToken,
          state.isApproving
        ),
      }
    }),
  removePendingByToken: (approvalToken) =>
    set((state) => {
      const normalizedToken = normalizeApprovalToken(approvalToken)
      if (!normalizedToken) return state

      const nextApprovalsByToken = { ...state.approvalsByToken }
      const nextApprovalOrder = state.approvalOrder.filter(
        (token) => token !== normalizedToken
      )
      const current = nextApprovalsByToken[normalizedToken]

      if (state.isApproving && state.activeApprovalToken === normalizedToken && current) {
        nextApprovalsByToken[normalizedToken] = {
          ...current,
          phase: "executing",
          updated_at: Date.now(),
        }
      } else {
        delete nextApprovalsByToken[normalizedToken]
      }

      return {
        ...state,
        approvalsByToken: nextApprovalsByToken,
        approvalOrder: nextApprovalOrder,
        ...deriveProjection(
          nextApprovalsByToken,
          nextApprovalOrder,
          state.activeApprovalToken,
          state.isApproving
        ),
      }
    }),
  setApproving: (isApproving) =>
    set((state) => ({
      ...state,
      ...deriveProjection(
        state.approvalsByToken,
        state.approvalOrder,
        isApproving ? state.activeApprovalToken : null,
        isApproving
      ),
    })),
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
      const tokenToClear = state.pending?.approval_token
      if (!tokenToClear) return state
      const normalizedToken = normalizeApprovalToken(tokenToClear)
      const nextApprovalsByToken = { ...state.approvalsByToken }
      const nextApprovalOrder = state.approvalOrder.filter(
        (token) => token !== normalizedToken
      )
      const current = nextApprovalsByToken[normalizedToken]

      if (state.isApproving && state.activeApprovalToken === normalizedToken && current) {
        nextApprovalsByToken[normalizedToken] = {
          ...current,
          phase: "executing",
          updated_at: Date.now(),
        }
      } else {
        delete nextApprovalsByToken[normalizedToken]
      }

      return {
        ...state,
        approvalsByToken: nextApprovalsByToken,
        approvalOrder: nextApprovalOrder,
        ...deriveProjection(
          nextApprovalsByToken,
          nextApprovalOrder,
          state.activeApprovalToken,
          state.isApproving
        ),
      }
    }),
  clearAll: () => {
    inFlightApprovalTokens.clear()
    set((state) => ({
      ...state,
      ...emptyProjection(),
    }))
  },
}))

let recentApprovedExecutionTimer: ReturnType<typeof setTimeout> | null = null
const inFlightApprovalTokens = new Set<string>()

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

export function beginBridgeApprovalExecution(approvalToken: string | null | undefined): boolean {
  const normalizedToken = normalizeApprovalToken(approvalToken)
  if (!normalizedToken) return false
  if (inFlightApprovalTokens.has(normalizedToken)) return false
  inFlightApprovalTokens.add(normalizedToken)
  useBridgeApprovalStore.setState((state) => ({
    ...state,
    ...deriveProjection(
      state.approvalsByToken,
      state.approvalOrder,
      normalizedToken,
      true
    ),
  }))
  return true
}

export function finishBridgeApprovalExecution(approvalToken: string | null | undefined) {
  const normalizedToken = normalizeApprovalToken(approvalToken)
  if (!normalizedToken) return
  inFlightApprovalTokens.delete(normalizedToken)
  useBridgeApprovalStore.setState((state) => {
    const nextApprovalsByToken = { ...state.approvalsByToken }
    const nextApprovalOrder = state.approvalOrder.filter(
      (token) => token !== normalizedToken
    )
    const activeNode = nextApprovalsByToken[normalizedToken]
    if (activeNode?.phase === "executing") {
      delete nextApprovalsByToken[normalizedToken]
    }

    const stillApproving = inFlightApprovalTokens.size > 0
    const nextActiveApprovalToken = stillApproving ? state.activeApprovalToken : null

    return {
      ...state,
      approvalsByToken: nextApprovalsByToken,
      approvalOrder: nextApprovalOrder,
      ...deriveProjection(
        nextApprovalsByToken,
        nextApprovalOrder,
        nextActiveApprovalToken,
        stillApproving
      ),
    }
  })
}
