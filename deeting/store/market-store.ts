"use client"

import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'

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

const isTauri = process.env.NEXT_PUBLIC_IS_TAURI === 'true'

const COLOR_PRESETS = [
  'from-indigo-500 to-purple-500',
  'from-sky-500 to-cyan-500',
  'from-emerald-500 to-green-500',
  'from-amber-500 to-orange-500',
  'from-rose-500 to-pink-500',
  'from-fuchsia-500 to-purple-500',
]

const hashToIndex = (value: string, modulo: number) => {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) % modulo
  }
  return hash
}

const assistantToAgent = (assistant: LocalAssistantRecord): Agent => {
  const color = COLOR_PRESETS[hashToIndex(assistant.id, COLOR_PRESETS.length)]
  return {
    id: assistant.id,
    name: assistant.name,
    desc: assistant.description ?? '',
    icon: assistant.avatar ?? undefined,
    tags: assistant.tags ?? [],
    author: assistant.source === 'market' ? 'Market' : 'Me',
    installs: '0',
    rating: 5.0,
    color,
    systemPrompt: assistant.system_prompt,
  }
}

export const useMarketStore = create<MarketState>()((set, get) => ({
  installedAgents: [],
  localAssistants: [],
  loaded: false,
  loadLocalAssistants: async () => {
    if (!isTauri) {
      set({ installedAgents: [], localAssistants: [], loaded: true })
      return
    }
    const assistants = await invoke<LocalAssistantRecord[]>('list_local_assistants')
    set({
      localAssistants: assistants,
      installedAgents: assistants.map(assistantToAgent),
      loaded: true,
    })
  },
  createLocalAssistant: async (payload) => {
    if (!isTauri) {
      throw new Error('local assistant storage is only available in desktop mode')
    }
    const id = await invoke<string>('create_local_assistant', { payload })
    await get().loadLocalAssistants()
    return id
  },
  updateLocalAssistant: async (id, payload) => {
    if (!isTauri) {
      throw new Error('local assistant storage is only available in desktop mode')
    }
    await invoke('update_local_assistant', { id, payload })
    await get().loadLocalAssistants()
  },
  deleteLocalAssistant: async (id) => {
    if (!isTauri) {
      throw new Error('local assistant storage is only available in desktop mode')
    }
    await invoke('delete_local_assistant', { id })
    await get().loadLocalAssistants()
  },
  isInstalled: (agentId) => get().installedAgents.some((a) => a.id === agentId),
}))
