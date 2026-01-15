import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface Agent {
  id: string
  name: string
  desc: string
  icon?: string // 这里可以是 lucide icon 的名字，或者 url
  tags: string[]
  author: string
  installs: string
  rating: number
  color: string // 渐变色 class
  systemPrompt?: string
}

interface MarketState {
  installedAgents: Agent[]
  createdAgents: Agent[] // 用户创建的助手
  installAgent: (agent: Agent) => void
  uninstallAgent: (agentId: string) => void
  createAgent: (agent: Omit<Agent, 'id' | 'installs' | 'rating' | 'author'>) => void
  isInstalled: (agentId: string) => boolean
}

export const useMarketStore = create<MarketState>()(
  persist(
    (set, get) => ({
      installedAgents: [],
      createdAgents: [],
      installAgent: (agent) => {
        if (get().isInstalled(agent.id)) return
        set((state) => ({
          installedAgents: [agent, ...state.installedAgents],
        }))
      },
      uninstallAgent: (agentId) => {
        set((state) => ({
          installedAgents: state.installedAgents.filter((a) => a.id !== agentId),
        }))
      },
      createAgent: (agentData) => {
        const newAgent: Agent = {
          ...agentData,
          id: `local-${Date.now()}`,
          installs: "0",
          rating: 5.0,
          author: "Me",
        }
        set((state) => ({
          createdAgents: [newAgent, ...state.createdAgents],
          installedAgents: [newAgent, ...state.installedAgents] // 创建即安装
        }))
      },
      isInstalled: (agentId) => {
        return get().installedAgents.some((a) => a.id === agentId)
      },
    }),
    {
      name: 'market-storage',
    }
  )
)
