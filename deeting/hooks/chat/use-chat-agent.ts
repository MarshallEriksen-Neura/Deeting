"use client"

import { useMemo, useEffect, useRef } from "react"
import { useChatStore, type ChatAssistant } from "@/store/chat-store"

interface UseChatAgentProps {
  selectedAssistantId: string
  isTauriRuntime: boolean
  cloudAssistant?: ChatAssistant
}

export function useChatAgent({ selectedAssistantId, isTauriRuntime, cloudAssistant }: UseChatAgentProps) {
  const { setSelectedAssistantId, setSelectedAssistant } = useChatStore()

  // 合并云端/本地代理
  const agent = useMemo(() => {
    if (isTauriRuntime) return null
    return cloudAssistant
  }, [isTauriRuntime, cloudAssistant])

  // 使用 ref 跟踪上一个 agent.id，避免重复同步
  const prevAgentIdRef = useRef<string | null>(null)

  // 同步代理到 store - 只在 agent.id 变化时执行
  useEffect(() => {
    if (!agent) return
    // 只在 agent.id 变化时才更新 store，避免不必要的状态更新
    if (prevAgentIdRef.current === agent.id) return
    prevAgentIdRef.current = agent.id
    setSelectedAssistant(agent as ChatAssistant)
  }, [agent, setSelectedAssistant])

  // 设置活跃代理 ID
  useEffect(() => {
    setSelectedAssistantId(selectedAssistantId)
  }, [selectedAssistantId, setSelectedAssistantId])

  return {
    agent,
    localAgent: null,
    marketLoaded: true,
  }
}
