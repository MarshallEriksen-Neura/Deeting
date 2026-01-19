"use client"

import * as React from "react"
import { invoke } from "@tauri-apps/api/core"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Bot } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useChatService } from "@/hooks/use-chat-service"
import { useI18n } from "@/hooks/use-i18n"
import { useMarketStore } from "@/store/market-store"
import { useChatStore, type Message, type ChatAssistant } from "@/store/chat-store"
import { ChatHeader } from "./chat-header"
import { ChatMessageList } from "./chat-message-list"
import { ChatInput } from "./chat-input"

interface ChatContainerProps {
  agentId: string
}

interface LocalAssistantMessageRecord {
  id: string
  assistant_id: string
  role: string
  content: string
  created_at: string
}

export function ChatContainer({ agentId }: ChatContainerProps) {
  const t = useI18n("chat")
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  
  // Stores
  const installedAgents = useMarketStore((state) => state.installedAgents)
  const loadLocalAssistants = useMarketStore((state) => state.loadLocalAssistants)
  const marketLoaded = useMarketStore((state) => state.loaded)
  
  const {
    input,
    messages,
    isLoading: isTyping,
    config,
    activeAssistantId,
    sessionId,
    streamEnabled,
    errorMessage,
    statusStage,
    statusCode,
    statusMeta,
    setInput,
    setModels,
    setActiveAssistantId,
    setSessionId,
    setStreamEnabled,
    setErrorMessage,
    setMessages,
    sendMessage: storeSendMessage,
    addMessage,
    setConfig,
    setAssistants,
    resetSession
  } = useChatStore()

  // Environment check (runtime-safe for browser dev)
  const isTauriRuntime =
    process.env.NEXT_PUBLIC_IS_TAURI === "true" &&
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)

  // Service hook for Cloud
  const {
    assistant: cloudAssistant,
    models: cloudModels,
    modelGroups: cloudModelGroups,
    isLoadingAssistants,
    isLoadingModels,
    loadHistory,
  } = useChatService({ assistantId: agentId, enabled: !isTauriRuntime })

  // Derived state
  const localAgent = installedAgents.find(a => a.id === agentId)
  
  // Combine cloud/local agent
  const agent = React.useMemo(() => {
    if (isTauriRuntime) return localAgent
    return cloudAssistant
  }, [isTauriRuntime, localAgent, cloudAssistant])

  // Sync assistants to store (optional, but good for consistency)
  React.useEffect(() => {
    if (agent) {
        setAssistants([agent as ChatAssistant])
    }
  }, [agent, setAssistants])

  const [historyLoaded, setHistoryLoaded] = React.useState(false)

  // Initialization & Sync
  React.useEffect(() => {
    setActiveAssistantId(agentId)
    setHistoryLoaded(false)
    setErrorMessage(null)
    setMessages([])
    setInput("")
  }, [agentId, setActiveAssistantId, setErrorMessage, setMessages, setInput])

  // Sync Stream Enabled from LocalStorage
  React.useEffect(() => {
    if (typeof window === "undefined") return
    const stored = localStorage.getItem("deeting-chat-stream")
    if (stored !== null) {
      setStreamEnabled(stored === "true")
    }
  }, [setStreamEnabled])

  React.useEffect(() => {
    if (typeof window === "undefined") return
    localStorage.setItem("deeting-chat-stream", String(streamEnabled))
  }, [streamEnabled])

  // Sync Models
  React.useEffect(() => {
    setModels(cloudModels)
    if (cloudModels.length === 0) return
    const hasSelectedModel = config.model
      ? cloudModels.some((model) => model.id === config.model || model.provider_model_id === config.model)
      : false
    if (!hasSelectedModel && cloudModels[0]) {
      setConfig({ model: cloudModels[0].provider_model_id ?? cloudModels[0].id })
    }
  }, [cloudModels, setModels, config.model, setConfig])

  // Session Management
  const sessionStorageKey = React.useMemo(
    () => `deeting-chat-session:${agentId}`,
    [agentId]
  )

  React.useEffect(() => {
    if (typeof window === "undefined") return
    if (!sessionId) return
    localStorage.setItem(sessionStorageKey, sessionId)
  }, [sessionId, sessionStorageKey])

  // Load History Logic
  React.useEffect(() => {
    if (!agent) return

    const greeting: Message = {
      id: 'init',
      role: 'assistant',
      content: t("greeting.content", {
        name: agent.name,
        desc: agent.desc || "",
      }),
      createdAt: Date.now()
    }

    if (!isTauriRuntime) {
      if (historyLoaded) return
      let cancelled = false
      const loadRemoteHistory = async () => {
        try {
          const querySessionId = searchParams?.get("session")?.trim() || null
          const storedSessionId =
            querySessionId ??
            (typeof window !== "undefined" ? localStorage.getItem(sessionStorageKey) : null)
          if (storedSessionId) {
            setSessionId(storedSessionId)
            if (querySessionId && typeof window !== "undefined") {
              localStorage.setItem(sessionStorageKey, storedSessionId)
            }
            const windowState = await loadHistory(storedSessionId)
            if (cancelled) return
            const rawMessages = (windowState.messages || [])
              .filter((msg) => msg.role === "user" || msg.role === "assistant")
            const total = rawMessages.length
            const mapped = rawMessages.map((msg, index) => ({
              id: `${storedSessionId}-${msg.turn_index ?? index}`,
              role: (msg.role === "assistant" ? "assistant" : "user") as 'user' | 'assistant',
              content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content ?? ""),
              createdAt: Date.now() - (total - index) * 1000,
            }))
            if (mapped.length > 0) {
              setMessages(mapped)
              setHistoryLoaded(true)
              return
            }
          }
          setMessages([greeting])
          setHistoryLoaded(true)
        } catch {
          if (!cancelled) {
            setMessages([greeting])
            setHistoryLoaded(true)
          }
        }
      }

      void loadRemoteHistory()
      return () => { cancelled = true }
    }

    // Tauri Local History
    if (historyLoaded) return
    let cancelled = false

    const loadLocalHistory = async () => {
      try {
        const records = await invoke<LocalAssistantMessageRecord[]>(
          "list_assistant_messages",
          { assistant_id: agent.id }
        )
        if (cancelled) return

        if (records.length > 0) {
          setMessages(
            records.map((record) => {
              const parsed = Date.parse(record.created_at)
              return {
                id: record.id,
                role: (record.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
                content: record.content,
                createdAt: Number.isNaN(parsed) ? Date.now() : parsed
              }
            })
          )
          setHistoryLoaded(true)
          return
        }

        setMessages([greeting])
        try {
          await invoke("append_assistant_message", {
            assistant_id: agent.id,
            role: "assistant",
            content: greeting.content
          })
        } catch (error) {
           // ignore persist errors
        }
        if (!cancelled) setHistoryLoaded(true)
      } catch (error) {
        if (!cancelled) {
          setMessages([greeting])
          setHistoryLoaded(true)
        }
      }
    }

    void loadLocalHistory()
    return () => { cancelled = true }
  }, [agent, historyLoaded, isTauriRuntime, loadHistory, searchParams, sessionStorageKey, t, setSessionId, setMessages, agentId])

  // Tauri Agent Loading
  React.useEffect(() => {
    if (!isTauriRuntime) return
    if (marketLoaded) return
    void loadLocalAssistants()
  }, [marketLoaded, loadLocalAssistants, isTauriRuntime])

  // Routing checks
  React.useEffect(() => {
    if (pathname?.includes("/chat/create/assistant")) return
    if (isTauriRuntime) {
      if (!marketLoaded) return
      // 桌面端仍保持兜底回到选择页
      if (!agent) router.replace("/chat")
      return
    }
    // Web 端不强制重定向，避免在助手信息未加载完时产生跳转循环
    if (isLoadingAssistants) return
  }, [agent, marketLoaded, router, isTauriRuntime, isLoadingAssistants, pathname])


  // Handlers
  const handleModelChange = (modelId: string) => {
     setConfig({ model: modelId })
  }

  const handleNewChat = () => {
    resetSession()
    const params = new URLSearchParams(searchParams?.toString())
    params.delete("session")
    const query = params.toString()
    const url = query ? `${pathname}?${query}` : pathname
    router.replace(url || "/chat")
  }

  const handleSendMessage = async () => {
     if (isTauriRuntime && agent) {
        const userContent = input.trim();
        if (!userContent) return;
        
        if (!config.model) {
            setErrorMessage(t("error.modelUnavailable"))
            return
        }
        
        // 1. Persist User Message to Tauri DB
        void invoke("append_assistant_message", {
          assistant_id: agent.id,
          role: "user",
          content: userContent
        }).catch(() => undefined)

        // 2. Delegate to Store (adds to UI, calls API)
        await storeSendMessage()

        // 3. Persist Assistant Response to Tauri DB
        const currentMessages = useChatStore.getState().messages
        const lastMsg = currentMessages[currentMessages.length - 1]
        if (lastMsg && lastMsg.role === 'assistant') {
             void invoke("append_assistant_message", {
                assistant_id: agent.id,
                role: "assistant",
                content: lastMsg.content
            }).catch(() => undefined)
        }
     } else {
        await storeSendMessage()
     }
  }

  // Loading / Empty States
  if (!agent) {
    if (!isTauriRuntime && isLoadingAssistants) {
      return (
        <div className="flex flex-col items-center justify-center h-[calc(100vh-60px)] space-y-4">
          <div className="bg-muted p-4 rounded-full">
            <Bot className="w-8 h-8 text-muted-foreground" />
          </div>
          <p className="text-muted-foreground">{t("empty.loading")}</p>
        </div>
      )
    }
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-60px)] space-y-4">
        <div className="bg-muted p-4 rounded-full">
          <Bot className="w-8 h-8 text-muted-foreground" />
        </div>
        <h1 className="text-xl font-bold">{t("empty.notFoundTitle")}</h1>
        <p className="text-muted-foreground">{t("empty.notFoundDesc")}</p>
        <Button onClick={() => router.push("/chat")}>
          {t("empty.backToList")}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[calc(100vh-60px)] bg-background">
      <ChatHeader 
        agent={agent as ChatAssistant}
        modelGroups={cloudModelGroups}
        selectedModelId={config.model}
        onModelChange={handleModelChange}
        streamEnabled={streamEnabled}
        onStreamChange={setStreamEnabled}
        isLoadingModels={isLoadingModels}
        onNewChat={handleNewChat}
      />

      <ChatMessageList 
        messages={messages}
        agent={agent as ChatAssistant}
        isTyping={isTyping}
        streamEnabled={streamEnabled}
        statusStage={statusStage}
        statusCode={statusCode}
        statusMeta={statusMeta}
      />

      <ChatInput 
        inputValue={input}
        onInputChange={setInput}
        onSend={handleSendMessage}
        disabled={isTyping || (!isTauriRuntime && isLoadingModels)}
        placeholderName={agent.name}
        errorMessage={errorMessage}
      />
    </div>
  )
}
