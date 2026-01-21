"use client"

import { useMemo, useEffect } from "react"
import { useChatStateStore, type ChatAssistant } from "@/store/chat-state-store"
import { useMarketStore } from "@/store/market-store"

interface UseChatAgentProps {
  agentId: string
  isTauriRuntime: boolean
  cloudAssistant?: ChatAssistant
}

export function useChatAgent({ agentId, isTauriRuntime, cloudAssistant }: UseChatAgentProps) {
  const installedAgents = useMarketStore((state) => state.installedAgents)
  const loadLocalAssistants = useMarketStore((state) => state.loadLocalAssistants)
  const marketLoaded = useMarketStore((state) => state.loaded)
  
  const { setActiveAssistantId, setAssistants } = useChatStateStore()

  // 获取本地代理
  const localAgent = installedAgents.find(a => a.id === agentId)
  
  // 合并云端/本地代理
  const agent = useMemo(() => {
    if (isTauriRuntime) return localAgent
    return cloudAssistant
  }, [isTauriRuntime, localAgent, cloudAssistant])

  // 同步代理到 store
  useEffect(() => {
    if (agent) {
      setAssistants([agent as ChatAssistant])
    }
  }, [agent, setAssistants])

  // 设置活跃代理 ID
  useEffect(() => {
    setActiveAssistantId(agentId)
  }, [agentId, setActiveAssistantId])

  // Tauri 代理加载
  useEffect(() => {
    if (!isTauriRuntime) return
    if (marketLoaded) return
    void loadLocalAssistants()
  }, [marketLoaded, loadLocalAssistants, isTauriRuntime])

  return {
    agent,
    localAgent,
    marketLoaded,
  }
}