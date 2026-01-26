"use client"

import { create } from "zustand"

import type {
  SpecConnection,
  SpecExecutionStatus,
  SpecManifest,
  SpecNode,
  SpecNodeStatus,
} from "@/lib/api/spec-agent"

export type SpecUiNodeType = "action" | "logic_gate" | "replan_trigger"
export type SpecUiNodeStatus = "pending" | "active" | "completed" | "error" | "waiting"

export interface SpecUiNode {
  id: string
  type: SpecUiNodeType
  title: string
  status: SpecUiNodeStatus
  position: { x: number; y: number }
  duration: string | null
  pulse: string | null
  desc?: string | null
  input?: string | null
  outputPreview?: string | null
  checkIn?: boolean
  raw?: SpecNode
}

export type DraftingState = {
  status: "idle" | "drafting" | "ready" | "error"
  message?: string | null
}

interface SpecAgentState {
  planId: string | null
  projectName: string | null
  manifest: SpecManifest | null
  nodes: SpecUiNode[]
  connections: SpecConnection[]
  execution: SpecExecutionStatus | null
  checkpoint: Record<string, unknown> | null
  drafting: DraftingState
  selectedNodeId: string | null
  setSelectedNodeId: (nodeId: string | null) => void
  reset: () => void
  startDrafting: () => void
  setDraftingError: (message?: string | null) => void
  setPlanInit: (planId: string, projectName?: string | null) => void
  setPlanReady: (planId?: string | null) => void
  setPlanDetail: (detail: {
    planId: string
    projectName: string
    manifest: SpecManifest
    connections: SpecConnection[]
    execution: SpecExecutionStatus
  }) => void
  applyNodeAdded: (node: SpecNode) => void
  applyLinkAdded: (link: SpecConnection) => void
  setExecution: (execution: SpecExecutionStatus) => void
  setCheckpoint: (checkpoint: Record<string, unknown> | null) => void
  applyStatusNodes: (nodes: SpecNodeStatus[]) => void
}

const emptyState: Omit<SpecAgentState, "setSelectedNodeId" | "reset" | "startDrafting" | "setDraftingError" | "setPlanInit" | "setPlanReady" | "setPlanDetail" | "applyNodeAdded" | "applyLinkAdded" | "setExecution" | "setCheckpoint" | "applyStatusNodes"> = {
  planId: null,
  projectName: null,
  manifest: null,
  nodes: [],
  connections: [],
  execution: null,
  checkpoint: null,
  drafting: { status: "idle" },
  selectedNodeId: null,
}

const buildNodeTitle = (node: SpecNode) => {
  if (node.desc) return node.desc
  if (node.type === "action") return node.instruction
  if (node.type === "logic_gate") return node.rules?.[0]?.desc ?? "Logic Gate"
  if (node.type === "replan_trigger") return node.reason
  return node.id
}

const buildDepthMap = (nodes: SpecNode[]) => {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const depthMap = new Map<string, number>()
  const visiting = new Set<string>()

  const dfs = (id: string): number => {
    if (depthMap.has(id)) return depthMap.get(id) as number
    if (visiting.has(id)) return 0
    visiting.add(id)
    const node = byId.get(id)
    if (!node) {
      visiting.delete(id)
      return 0
    }
    let depth = 0
    for (const dep of node.needs ?? []) {
      depth = Math.max(depth, dfs(dep) + 1)
    }
    visiting.delete(id)
    depthMap.set(id, depth)
    return depth
  }

  nodes.forEach((node) => {
    dfs(node.id)
  })

  return depthMap
}

const layoutNodes = (nodes: SpecNode[], prev: SpecUiNode[]) => {
  const depthMap = buildDepthMap(nodes)
  const grouped = new Map<number, string[]>()
  const orderedIds = nodes.map((node) => node.id)
  orderedIds.forEach((id) => {
    const depth = depthMap.get(id) ?? 0
    const list = grouped.get(depth) ?? []
    list.push(id)
    grouped.set(depth, list)
  })

  const positions = new Map<string, { x: number; y: number }>()
  grouped.forEach((ids, depth) => {
    ids.forEach((id, idx) => {
      positions.set(id, {
        x: 140 + depth * 280,
        y: 120 + idx * 160,
      })
    })
  })

  const prevMap = new Map(prev.map((item) => [item.id, item]))

  return nodes.map((node) => {
    const previous = prevMap.get(node.id)
    return {
      id: node.id,
      type: node.type as SpecUiNodeType,
      title: buildNodeTitle(node),
      status: previous?.status ?? "pending",
      position: positions.get(node.id) ?? { x: 140, y: 120 },
      duration: previous?.duration ?? null,
      pulse: previous?.pulse ?? null,
      desc: node.desc ?? null,
      input: node.type === "logic_gate" ? node.input : null,
      outputPreview: previous?.outputPreview ?? null,
      checkIn: node.type === "action" ? node.check_in : false,
      raw: node,
    } satisfies SpecUiNode
  })
}

const normalizeDuration = (durationMs: number | null | undefined) => {
  if (!durationMs || durationMs <= 0) return null
  const seconds = durationMs / 1000
  if (seconds < 1) return `${seconds.toFixed(2)}s`
  if (seconds < 10) return `${seconds.toFixed(1)}s`
  return `${seconds.toFixed(0)}s`
}

export const useSpecAgentStore = create<SpecAgentState>()((set, get) => ({
  ...emptyState,
  setSelectedNodeId: (nodeId) => set({ selectedNodeId: nodeId }),
  reset: () => set({ ...emptyState }),
  startDrafting: () =>
    set({
      ...emptyState,
      drafting: { status: "drafting" },
    }),
  setDraftingError: (message) =>
    set((state) => ({
      drafting: { status: "error", message: message ?? null },
      planId: state.planId,
    })),
  setPlanInit: (planId, projectName) =>
    set({
      planId,
      projectName: projectName ?? null,
      drafting: { status: "drafting" },
    }),
  setPlanReady: (planId) =>
    set((state) => ({
      planId: planId ?? state.planId,
      drafting: { status: "ready" },
    })),
  setPlanDetail: (detail) =>
    set((state) => ({
      planId: detail.planId,
      projectName: detail.projectName,
      manifest: detail.manifest,
      connections: detail.connections ?? [],
      nodes: layoutNodes(detail.manifest.nodes, state.nodes),
      execution: detail.execution,
      drafting: { status: "ready" },
    })),
  applyNodeAdded: (node) =>
    set((state) => {
      const exists = state.manifest?.nodes?.some((item) => item.id === node.id)
      const nextNodes = exists
        ? state.manifest?.nodes?.map((item) => (item.id === node.id ? node : item)) ?? [node]
        : [...(state.manifest?.nodes ?? []), node]
      const manifest = state.manifest
        ? { ...state.manifest, nodes: nextNodes }
        : { spec_v: "1.2", project_name: state.projectName ?? "", nodes: nextNodes }
      return {
        manifest,
        nodes: layoutNodes(nextNodes, state.nodes),
      }
    }),
  applyLinkAdded: (link) =>
    set((state) => {
      const exists = state.connections.some(
        (item) => item.source === link.source && item.target === link.target
      )
      return {
        connections: exists ? state.connections : [...state.connections, link],
      }
    }),
  setExecution: (execution) => set({ execution }),
  setCheckpoint: (checkpoint) => set({ checkpoint }),
  applyStatusNodes: (nodes) =>
    set((state) => {
      if (!nodes.length) return state
      const statusMap = new Map(nodes.map((item) => [item.id, item]))
      const nextUiNodes = state.nodes.map((node) => {
        const status = statusMap.get(node.id)
        if (!status) return node
        return {
          ...node,
          status: status.status as SpecUiNodeStatus,
          duration: normalizeDuration(status.duration_ms) ?? node.duration,
          pulse: status.pulse ?? node.pulse,
          outputPreview: status.output_preview ?? node.outputPreview,
        }
      })
      return { nodes: nextUiNodes }
    }),
}))
