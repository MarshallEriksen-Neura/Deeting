"use client"

import { create } from 'zustand'

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

export interface LocalAssistantRecord {
  id: string
  name: string
  description?: string | null
  avatar?: string | null
  system_prompt: string
  model_config?: Record<string, unknown> | null
  tags: string[]
  visibility: string
  source: string
  cloud_id?: string | null
  is_deleted: boolean
  created_at: string
  updated_at: string
}

export interface CreateLocalAssistantPayload {
  name: string
  description?: string | null
  avatar?: string | null
  system_prompt: string
  model_config?: Record<string, unknown> | null
  tags?: string[]
  visibility?: string
  source?: string
  cloud_id?: string | null
}

export interface UpdateLocalAssistantPayload {
  name?: string
  description?: string | null
  avatar?: string | null
  system_prompt?: string
  model_config?: Record<string, unknown> | null
  tags?: string[]
  visibility?: string
  source?: string
  cloud_id?: string | null
}

interface MarketState {
  installedAgents: Agent[]
  localAssistants: LocalAssistantRecord[]
  loaded: boolean
  loadLocalAssistants: () => Promise<void>
  createLocalAssistant: (payload: CreateLocalAssistantPayload) => Promise<string>
  updateLocalAssistant: (id: string, payload: UpdateLocalAssistantPayload) => Promise<void>
  deleteLocalAssistant: (id: string) => Promise<void>
  isInstalled: (agentId: string) => boolean
}

export const useMarketStore = create<MarketState>()((set, get) => ({
  installedAgents: [],
  localAssistants: [],
  loaded: false,
  loadLocalAssistants: async () => {
    set({ installedAgents: [], localAssistants: [], loaded: true })
  },
  createLocalAssistant: async (_payload) => {
    throw new Error('local assistant authoring has moved to the cloud')
  },
  updateLocalAssistant: async (_id, _payload) => {
    throw new Error('local assistant authoring has moved to the cloud')
  },
  deleteLocalAssistant: async (_id) => {
    throw new Error('local assistant authoring has moved to the cloud')
  },
  isInstalled: (agentId) => get().installedAgents.some((a) => a.id === agentId),
}))
