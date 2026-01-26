// Spec Agent 类型定义

export type NodeType = 'action' | 'logic_gate'

export type NodeStatus = 'pending' | 'active' | 'completed' | 'error' | 'waiting'

export interface SpecNode {
  id: string
  type: NodeType
  title: string
  status: NodeStatus
  position: { x: number; y: number }
  duration: string | null
  pulse: string | null
  input?: any
  output?: any
  logs?: string[]
  needs?: string[]
  checkIn?: boolean
}

export interface SpecConnection {
  from: string
  to: string
  isActive?: boolean
}

export interface SpecDAG {
  nodes: SpecNode[]
  connections: SpecConnection[]
}

export interface SpecExecution {
  id: string
  projectName: string
  status: 'drafting' | 'running' | 'completed' | 'error' | 'waiting'
  progress: number
  estimatedTime?: string
  tokenCost?: number
  startTime: Date
  endTime?: Date
}

export interface CheckpointDecision {
  nodeId: string
  title: string
  description: string
  options: {
    id: string
    label: string
    description?: string
    preview?: SpecDAG // 选择后的分支预览
  }[]
  timeout?: number
}

export interface ConsoleMessage {
  id: string
  type: 'user' | 'system' | 'agent'
  content: string
  timestamp: string
  metadata?: any
}

// API 响应类型
export interface SpecAgentStatus {
  execution: SpecExecution
  currentNode?: string
  checkpoint?: CheckpointDecision
  stats: {
    totalNodes: number
    completedNodes: number
    activeNodes: number
    errorNodes: number
  }
}

export interface SpecAgentStreamEvent {
  type: 'node_update' | 'checkpoint' | 'completion' | 'error'
  data: any
  timestamp: string
}