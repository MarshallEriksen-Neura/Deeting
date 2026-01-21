"use client"

import { useEffect, useCallback } from "react"
import { useChatStateStore } from "@/store/chat-state-store"

export function useChatStream() {
  const { streamEnabled, setStreamEnabled } = useChatStateStore()

  // 从 localStorage 同步流式模式设置
  useEffect(() => {
    if (typeof window === "undefined") return
    
    const stored = localStorage.getItem("deeting-chat-stream")
    if (stored !== null) {
      setStreamEnabled(stored === "true")
    }
  }, [setStreamEnabled])

  // 保存流式模式设置到 localStorage
  useEffect(() => {
    if (typeof window === "undefined") return
    localStorage.setItem("deeting-chat-stream", String(streamEnabled))
  }, [streamEnabled])

  const handleStreamChange = useCallback((enabled: boolean) => {
    setStreamEnabled(enabled)
  }, [setStreamEnabled])

  return {
    streamEnabled,
    handleStreamChange,
  }
}