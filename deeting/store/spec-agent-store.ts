"use client"

import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"

import type {
  SpecConnection,
  SpecExecutionStatus,
  SpecManifest,
  SpecNode,
  SpecNodeStatus,
} from "@/lib/api/spec-agent"

export type SpecUiNodeType = "action" | "logic_gate" | "replan_trigger"
export type SpecUiNodeStatus = "pending" | "active" | "completed" | "error" | "waiting"
export type SpecUiNodeStage =
  | "search"
  | "process"
  | "summary"
  | "action"
  | "unknown"

export type SpecAgentLayoutState = {
  consoleSize: number
  canvasSize: number
  consoleCollapsed: boolean
  canvasCollapsed: boolean
}

export interface SpecUiNode {
  id: string
  type: SpecUiNodeType
  title: string
  status: SpecUiNodeStatus
  position: { x: number; y: number }
  duration: string | null
  pulse: string | null
  stage?: SpecUiNodeStage
  desc?: string | null
  input?: string | null
  outputPreview?: string | null
  checkIn?: boolean
  modelOverride?: string | null
  pendingInstruction?: string | null
  logs?: string[]
  raw?: SpecNode
}

export type DraftingState = {
  status: "idle" | "drafting" | "ready" | "error"
  message?: string | null
}

interface SpecAgentState {
  planId: string | null
  conversationSessionId: string | null
  projectName: string | null
  manifest: SpecManifest | null
  nodes: SpecUiNode[]
  connections: SpecConnection[]
  execution: SpecExecutionStatus | null
  checkpoint: Record<string, unknown> | null
  drafting: DraftingState
  plannerModel: string | null
  layout: SpecAgentLayoutState
  selectedNodeId: string | null
  highlightNodeId: string | null
  focusNodeId: string | null
  setSelectedNodeId: (nodeId: string | null) => void
  setHighlightNodeId: (nodeId: string | null) => void
  setFocusNodeId: (nodeId: string | null) => void
  setPlannerModel: (model: string | null) => void
  setConversationSessionId: (sessionId: string | null) => void
  setLayout: (layout: Partial<SpecAgentLayoutState>) => void
  reset: () => void
  startDrafting: () => void
  setDraftingError: (message?: string | null) => void
  setPlanInit: (
    planId: string,
    projectName?: string | null,
    conversationSessionId?: string | null
  ) => void
  setPlanReady: (planId?: string | null) => void
  setPlanDetail: (detail: {
    planId: string
    conversationSessionId?: string | null
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
  applyNodeModelOverride: (nodeId: string, modelOverride: string | null) => void
  applyNodeInstructionUpdate: (nodeId: string, instruction: string) => void
  applyNodePendingInstruction: (nodeId: string, instruction: string | null) => void
}

const defaultLayoutState: SpecAgentLayoutState = {
  consoleSize: 28,
  canvasSize: 72,
  consoleCollapsed: false,
  canvasCollapsed: false,
}

const emptyState: Omit<SpecAgentState, "setSelectedNodeId" | "setHighlightNodeId" | "setFocusNodeId" | "setPlannerModel" | "setConversationSessionId" | "setLayout" | "reset" | "startDrafting" | "setDraftingError" | "setPlanInit" | "setPlanReady" | "setPlanDetail" | "applyNodeAdded" | "applyLinkAdded" | "setExecution" | "setCheckpoint" | "applyStatusNodes" | "applyNodeModelOverride" | "applyNodeInstructionUpdate" | "applyNodePendingInstruction"> = {
  planId: null,
  conversationSessionId: null,
  projectName: null,
  manifest: null,
  nodes: [],
  connections: [],
  execution: null,
  checkpoint: null,
  drafting: { status: "idle" },
  plannerModel: null,
  layout: { ...defaultLayoutState },
  selectedNodeId: null,
  highlightNodeId: null,
  focusNodeId: null,
}

const buildNodeTitle = (node: SpecNode) => {
  if (node.desc) return node.desc
  if (node.type === "action") return node.instruction
  if (node.type === "logic_gate") return node.rules?.[0]?.desc ?? "Logic Gate"
  if (node.type === "replan_trigger") return node.reason
  return node.id
}

const SEARCH_TOOL_PREFIX = "mcp.search."
const PROCESS_KEYWORDS = [
  "计算",
  "对比",
  "转换",
  "比价",
  "比较",
  "汇率",
  "calculate",
  "compare",
  "convert",
]
const SUMMARY_KEYWORDS = ["报告", "结论", "建议", "总结", "summary", "recommend"]
const ACTION_KEYWORDS = [
  "下单",
  "发邮件",
  "邮件",
  "发送",
  "写入",
  "存入",
  "保存",
  "通知",
  "推送",
  "order",
  "email",
  "save",
  "insert",
]

const includesAny = (source: string, keywords: string[]) =>
  keywords.some((keyword) => source.includes(keyword))

const deriveNodeStage = (node: SpecNode): SpecUiNodeStage => {
  if (node.type === "action") {
    const tools = node.required_tools ?? []
    const hasSearchTool = tools.some((tool) => tool.startsWith(SEARCH_TOOL_PREFIX))
    const isSearchWorker = (node.worker ?? "").startsWith(SEARCH_TOOL_PREFIX)
    if (hasSearchTool || isSearchWorker) return "search"
  }

  if (node.type === "logic_gate") return "process"

  const text = [
    node.id,
    node.desc,
    node.type === "action" ? node.instruction : null,
    node.type === "replan_trigger" ? node.reason : null,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()

  if (includesAny(text, SUMMARY_KEYWORDS)) return "summary"
  if (includesAny(text, ACTION_KEYWORDS)) return "action"
  if (includesAny(text, PROCESS_KEYWORDS)) return "process"
  return "process"
}

const STAGE_ORDER: SpecUiNodeStage[] = [
  "search",
  "process",
  "summary",
  "action",
  "unknown",
]
const STAGE_PADDING = 100
const STAGE_GAP = 160
const STAGE_MIN_HEIGHT = 260
const STAGE_NODE_GAP = 180

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
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const stageById = new Map<string, SpecUiNodeStage>()
  orderedIds.forEach((id) => {
    const node = nodeById.get(id)
    if (!node) return
    stageById.set(id, deriveNodeStage(node))
  })

  const stageBuckets = new Map<SpecUiNodeStage, string[]>()
  STAGE_ORDER.forEach((stage) => stageBuckets.set(stage, []))
  orderedIds.forEach((id) => {
    const stage = stageById.get(id) ?? "unknown"
    const bucket = stageBuckets.get(stage)
    if (bucket) bucket.push(id)
  })

  const stageIndexMap = new Map<string, number>()
  stageBuckets.forEach((ids) => {
    ids.forEach((id, index) => {
      stageIndexMap.set(id, index)
    })
  })

  const stageLayout = new Map<SpecUiNodeStage, { top: number; height: number }>()
  let currentTop = 160
  STAGE_ORDER.forEach((stage) => {
    const ids = stageBuckets.get(stage) ?? []
    if (!ids.length) return
    const height = Math.max(
      STAGE_MIN_HEIGHT,
      STAGE_PADDING * 2 + Math.max(ids.length - 1, 0) * STAGE_NODE_GAP
    )
    stageLayout.set(stage, { top: currentTop, height })
    currentTop += height + STAGE_GAP
  })
  orderedIds.forEach((id) => {
    const depth = depthMap.get(id) ?? 0
    const list = grouped.get(depth) ?? []
    list.push(id)
    grouped.set(depth, list)
  })

  const positions = new Map<string, { x: number; y: number }>()
  grouped.forEach((ids, depth) => {
    ids.forEach((id, idx) => {
      const stage = stageById.get(id) ?? "unknown"
      const stageTop = stageLayout.get(stage)?.top ?? 120
      const stageIndex = stageIndexMap.get(id) ?? idx
      positions.set(id, {
        x: 180 + depth * 360,
        y: stageTop + STAGE_PADDING + stageIndex * STAGE_NODE_GAP,
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
      stage: stageById.get(node.id) ?? deriveNodeStage(node),
      desc: node.desc ?? null,
      input: node.type === "logic_gate" ? node.input : null,
      outputPreview: previous?.outputPreview ?? null,
      checkIn: node.type === "action" ? node.check_in : false,
      modelOverride:
        node.type === "action" ? node.model_override ?? null : null,
      pendingInstruction:
        node.type === "action" ? node.pending_instruction ?? null : null,
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

export const useSpecAgentStore = create<SpecAgentState>()(
  persist(
    (set, get) => ({
      ...emptyState,
      setSelectedNodeId: (nodeId) => set({ selectedNodeId: nodeId }),
      setHighlightNodeId: (nodeId) => set({ highlightNodeId: nodeId }),
      setFocusNodeId: (nodeId) => set({ focusNodeId: nodeId }),
      setPlannerModel: (model) => set({ plannerModel: model }),
      setConversationSessionId: (sessionId) => set({ conversationSessionId: sessionId }),
      setLayout: (layout) =>
        set((state) => ({
          layout: { ...state.layout, ...layout },
        })),
      reset: () =>
        set((state) => ({
          ...emptyState,
          plannerModel: state.plannerModel,
          layout: state.layout,
        })),
      startDrafting: () =>
        set((state) => ({
          ...emptyState,
          plannerModel: state.plannerModel,
          layout: state.layout,
          drafting: { status: "drafting" },
        })),
      setDraftingError: (message) =>
        set((state) => ({
          drafting: { status: "error", message: message ?? null },
          planId: state.planId,
        })),
      setPlanInit: (planId, projectName, conversationSessionId) =>
        set({
          planId,
          conversationSessionId: conversationSessionId ?? null,
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
          conversationSessionId: detail.conversationSessionId ?? null,
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
              logs: status.logs ?? node.logs,
            }
          })
          return { nodes: nextUiNodes }
        }),
      applyNodeModelOverride: (nodeId, modelOverride) =>
        set((state) => {
          if (!state.manifest) return state
          const nextNodes = state.manifest.nodes.map((node) => {
            if (node.id !== nodeId || node.type !== "action") return node
            return { ...node, model_override: modelOverride }
          })
          return {
            manifest: { ...state.manifest, nodes: nextNodes },
            nodes: layoutNodes(nextNodes, state.nodes),
          }
        }),
      applyNodeInstructionUpdate: (nodeId, instruction) =>
        set((state) => {
          if (!state.manifest) return state
          const nextNodes = state.manifest.nodes.map((node) => {
            if (node.id !== nodeId || node.type !== "action") return node
            return { ...node, instruction, pending_instruction: null }
          })
          return {
            manifest: { ...state.manifest, nodes: nextNodes },
            nodes: layoutNodes(nextNodes, state.nodes),
          }
        }),
      applyNodePendingInstruction: (nodeId, instruction) =>
        set((state) => {
          if (!state.manifest) return state
          const nextNodes = state.manifest.nodes.map((node) => {
            if (node.id !== nodeId || node.type !== "action") return node
            return { ...node, pending_instruction: instruction }
          })
          return {
            manifest: { ...state.manifest, nodes: nextNodes },
            nodes: layoutNodes(nextNodes, state.nodes),
          }
        }),
    }),
    {
      name: "deeting-spec-agent-store",
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        plannerModel: state.plannerModel,
        layout: state.layout,
      }),
    }
  )
)
