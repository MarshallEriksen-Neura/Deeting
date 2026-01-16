"use client"

import * as React from "react"
import { use } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useRouter } from "next/navigation"
import { Send, Bot, User, Sparkles, ArrowLeft } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useChatService } from "@/hooks/use-chat-service"
import { useI18n } from "@/hooks/use-i18n"
import {
  createChatCompletion,
  streamChatCompletion,
  type ChatMessage,
} from "@/lib/api/chat"
import type { ModelInfo } from "@/lib/api/models"
import { useMarketStore } from "@/store/market-store"
import { cn } from "@/lib/utils"
import { AIResponseBubble, type MessagePart } from "../components/ai-response-bubble"

interface ChatPageProps {
  params: Promise<{ agentId: string }>
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
}

function parseMessageContent(content: string): MessagePart[] {
  const parts: MessagePart[] = [];
  const thinkRegex = /<think>([\s\S]*?)<\/think>/g;
  let lastIndex = 0;
  let match;

  while ((match = thinkRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      const text = content.substring(lastIndex, match.index);
      if (text.trim()) parts.push({ type: 'text', content: text });
    }
    parts.push({ type: 'thought', content: match[1].trim() });
    lastIndex = thinkRegex.lastIndex;
  }
  
  if (lastIndex < content.length) {
    const text = content.substring(lastIndex);
    if (text.trim()) parts.push({ type: 'text', content: text });
  }
  
  if (parts.length === 0 && content) {
    return [{ type: 'text', content }];
  }
  return parts;
}

interface LocalAssistantMessageRecord {
  id: string
  assistant_id: string
  role: string
  content: string
  created_at: string
}

export default function AgentChatPage({ params }: ChatPageProps) {
  // Unwrap params using React.use()
  const { agentId } = use(params)
  const t = useI18n("chat")
  
  const router = useRouter()
  const installedAgents = useMarketStore((state) => state.installedAgents)
  const loadLocalAssistants = useMarketStore((state) => state.loadLocalAssistants)
  const loaded = useMarketStore((state) => state.loaded)
  const isTauri = process.env.NEXT_PUBLIC_IS_TAURI === "true"
  const defaultTemperature = 0.7
  const defaultMaxTokens = 2048
  const {
    assistant: cloudAssistant,
    models,
    isLoadingAssistants,
    isLoadingModels,
    loadHistory,
  } = useChatService({ assistantId: agentId, enabled: !isTauri })
  const localAgent = installedAgents.find(a => a.id === agentId)
  const agent = isTauri ? localAgent : cloudAssistant

  // 简单的本地消息状态
  const [messages, setMessages] = React.useState<Message[]>([])
  const [inputValue, setInputValue] = React.useState("")
  const [isTyping, setIsTyping] = React.useState(false)
  const [historyLoaded, setHistoryLoaded] = React.useState(false)
  const [streamEnabled, setStreamEnabled] = React.useState(false)
  const [selectedModelId, setSelectedModelId] = React.useState<string | null>(null)
  const [sessionId, setSessionId] = React.useState<string | null>(null)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const scrollRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    setMessages([])
    setInputValue("")
    setIsTyping(false)
    setHistoryLoaded(false)
    setSessionId(null)
    setErrorMessage(null)
  }, [agentId])

  React.useEffect(() => {
    if (typeof window === "undefined") return
    const stored = localStorage.getItem("deeting-chat-stream")
    if (stored !== null) {
      setStreamEnabled(stored === "true")
    }
  }, [])

  React.useEffect(() => {
    if (typeof window === "undefined") return
    localStorage.setItem("deeting-chat-stream", String(streamEnabled))
  }, [streamEnabled])

  const modelStorageKey = React.useMemo(
    () => `deeting-chat-model:${agentId}`,
    [agentId]
  )
  const sessionStorageKey = React.useMemo(
    () => `deeting-chat-session:${agentId}`,
    [agentId]
  )

  React.useEffect(() => {
    if (typeof window === "undefined") return
    if (!sessionId) return
    localStorage.setItem(sessionStorageKey, sessionId)
  }, [sessionId, sessionStorageKey])

  const selectedModel = React.useMemo<ModelInfo | null>(() => {
    if (!models.length) return null
    if (selectedModelId) {
      const matched = models.find(
        (model) => (model.provider_model_id ?? model.id) === selectedModelId
      )
      if (matched) return matched
    }
    return models[0] ?? null
  }, [models, selectedModelId])

  React.useEffect(() => {
    if (typeof window === "undefined") return
    if (!models.length) return
    const stored = localStorage.getItem(modelStorageKey)
    const matched = stored
      ? models.find((model) => (model.provider_model_id ?? model.id) === stored)
      : null
    const nextValue =
      matched?.provider_model_id ?? matched?.id ?? models[0]?.provider_model_id ?? models[0]?.id
    if (nextValue && nextValue !== selectedModelId) {
      setSelectedModelId(nextValue)
    }
  }, [models, modelStorageKey, selectedModelId])

  React.useEffect(() => {
    if (typeof window === "undefined") return
    if (!selectedModelId) return
    localStorage.setItem(modelStorageKey, selectedModelId)
  }, [modelStorageKey, selectedModelId])

  // 初始问候语 / 历史加载
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

    if (!isTauri) {
      if (historyLoaded) return
      let cancelled = false
      const loadRemoteHistory = async () => {
        try {
          const storedSessionId =
            typeof window !== "undefined"
              ? localStorage.getItem(sessionStorageKey)
              : null
          if (storedSessionId) {
            setSessionId(storedSessionId)
            const windowState = await loadHistory(storedSessionId)
            if (cancelled) return
            const rawMessages = (windowState.messages || [])
              .filter((msg) => msg.role === "user" || msg.role === "assistant")
            const total = rawMessages.length
            const mapped = rawMessages.map((msg, index) => ({
              id: `${storedSessionId}-${msg.turn_index ?? index}`,
              role: (msg.role === "assistant" ? "assistant" : "user") as 'user' | 'assistant',
              content:
                typeof msg.content === "string"
                  ? msg.content
                  : JSON.stringify(msg.content ?? ""),
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
      return () => {
        cancelled = true
      }
    }

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
                role: record.role === 'user' ? 'user' : 'assistant',
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
        if (!cancelled) {
          setHistoryLoaded(true)
        }
      } catch (error) {
        if (!cancelled) {
          setMessages([greeting])
          setHistoryLoaded(true)
        }
      }
    }

    void loadLocalHistory()

    return () => {
      cancelled = true
    }
  }, [agent, historyLoaded, isTauri, loadHistory, sessionStorageKey, t])

  React.useEffect(() => {
    if (!isTauri) return
    if (loaded) return
    void loadLocalAssistants()
  }, [loaded, loadLocalAssistants, isTauri])

  React.useEffect(() => {
    if (isTauri) {
      if (!loaded) return
      if (!agent) {
        router.replace('/chat/select-agent')
      }
      return
    }
    if (isLoadingAssistants) return
    if (!agent) {
      router.replace('/chat/select-agent')
    }
  }, [agent, loaded, router, isTauri, isLoadingAssistants])

  // 自动滚动到底部
  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, isTyping])

  const updateMessageContent = React.useCallback((id: string, content: string) => {
    setMessages((prev) =>
      prev.map((msg) => (msg.id === id ? { ...msg, content } : msg))
    )
  }, [])

  const buildChatMessages = React.useCallback(
    (history: Message[]): ChatMessage[] => {
      const mapped = history.map((msg) => ({
        role: msg.role,
        content: msg.content,
      })) as ChatMessage[]

      const systemPrompt = agent?.systemPrompt?.trim()
      if (systemPrompt && !mapped.some((msg) => msg.role === "system")) {
        mapped.unshift({ role: "system", content: systemPrompt })
      }

      return mapped
    },
    [agent]
  )

  const ensureSessionId = React.useCallback(() => {
    if (sessionId) return sessionId
    const nextId = typeof crypto?.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`
    setSessionId(nextId)
    return nextId
  }, [sessionId])

  if (!agent) {
    if (!isTauri && isLoadingAssistants) {
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
        <Button onClick={() => router.push('/chat/select-agent')}>
          {t("empty.backToList")}
        </Button>
      </div>
    )
  }

  const handleSendMessage = async () => {
    if (!inputValue.trim() || !agent || isTyping) return
    if (!selectedModel) {
      setErrorMessage(t("error.modelUnavailable"))
      return
    }

    setErrorMessage(null)
    const userContent = inputValue.trim()
    const activeSessionId = ensureSessionId()
    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: userContent,
      createdAt: Date.now()
    }
    const assistantMsg: Message = {
      id: `${Date.now() + 1}-assistant`,
      role: "assistant",
      content: "",
      createdAt: Date.now(),
    }

    const nextMessages = [...messages, userMsg]
    const requestMessages = buildChatMessages(nextMessages)
    const payload = {
      model: selectedModel.id,
      provider_model_id: selectedModel.provider_model_id ?? undefined,
      messages: requestMessages,
      temperature: defaultTemperature,
      max_tokens: defaultMaxTokens,
      assistant_id: agent.id,
      session_id: activeSessionId,
    }

    setMessages(prev => [...prev, userMsg, assistantMsg])
    setInputValue("")
    setIsTyping(true)

    if (isTauri) {
      void invoke("append_assistant_message", {
        assistant_id: agent.id,
        role: "user",
        content: userContent
      }).catch(() => undefined)
    }

    let finalAssistantContent = ""
    try {
      if (streamEnabled) {
        await streamChatCompletion(payload, {
          onDelta: (_delta, snapshot) => {
            finalAssistantContent = snapshot
            updateMessageContent(assistantMsg.id, snapshot)
          },
        })
      } else {
        const response = await createChatCompletion({ ...payload, stream: false })
        if (response?.session_id && response.session_id !== sessionId) {
          setSessionId(response.session_id)
        }
        const reply =
          response?.choices?.[0]?.message?.content ||
          t("error.requestFailed")
        finalAssistantContent = reply
        updateMessageContent(assistantMsg.id, reply)
      }
      if (isTauri && finalAssistantContent) {
        void invoke("append_assistant_message", {
          assistant_id: agent.id,
          role: "assistant",
          content: finalAssistantContent
        }).catch(() => undefined)
      }
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : t("error.requestFailed")
      setErrorMessage(message)
      finalAssistantContent = message
      updateMessageContent(assistantMsg.id, message)
      if (isTauri) {
        void invoke("append_assistant_message", {
          assistant_id: agent.id,
          role: "assistant",
          content: message
        }).catch(() => undefined)
      }
    } finally {
      setIsTyping(false)
    }
  }

  const isInputDisabled = !selectedModel || isTyping || isLoadingModels

  return (
    <div className="flex flex-col h-[calc(100vh-60px)] bg-background">
      {/* 顶部导航条 */}
      <header className="h-14 border-b flex items-center px-4 justify-between bg-background/80 backdrop-blur sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.push('/assistants')} className="md:hidden">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className={cn("w-8 h-8 rounded-lg bg-gradient-to-br flex items-center justify-center text-white shadow-sm", agent.color)}>
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-semibold text-sm">{agent.name}</h1>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              {t("header.online")}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-full bg-white/70 dark:bg-white/10 px-3 py-1 shadow-sm ring-1 ring-black/5 dark:ring-white/10 backdrop-blur">
            <Label className="text-xs text-muted-foreground">{t("model.label")}</Label>
            <Select
              value={selectedModelId ?? ""}
              onValueChange={setSelectedModelId}
              disabled={isLoadingModels || models.length === 0}
            >
              <SelectTrigger className="h-7 w-[200px] border-0 bg-transparent text-xs shadow-none focus:ring-0">
                <SelectValue placeholder={t("model.placeholder")} />
              </SelectTrigger>
              <SelectContent>
                {models.map((model) => {
                  const modelValue = model.provider_model_id ?? model.id
                  const provider = model.owned_by || "provider"
                  return (
                    <SelectItem key={modelValue} value={modelValue}>
                      <div className="flex flex-col">
                        <span className="text-xs font-medium text-foreground">{model.id}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {provider}
                        </span>
                      </div>
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 rounded-full bg-white/70 dark:bg-white/10 px-3 py-1 shadow-sm ring-1 ring-black/5 dark:ring-white/10 backdrop-blur">
            <Label className="text-xs text-muted-foreground">{t("header.stream")}</Label>
            <Switch checked={streamEnabled} onCheckedChange={setStreamEnabled} />
            <span className="text-[10px] text-muted-foreground/70">
              {streamEnabled ? t("header.streamOn") : t("header.streamOff")}
            </span>
          </div>
          <Button variant="ghost" size="icon">
            <Sparkles className="w-4 h-4 text-muted-foreground" />
          </Button>
        </div>
      </header>

      {/* 消息区域 */}
      <ScrollArea className="flex-1 p-4">
        <div className="max-w-3xl mx-auto space-y-6 py-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "flex gap-3",
                msg.role === 'user' ? "flex-row-reverse" : "flex-row"
              )}
            >
              {/* 头像 */}
              <Avatar className="w-8 h-8 mt-1 border shadow-sm">
                {msg.role === 'assistant' ? (
                  <>
                    <AvatarImage src={`https://api.dicebear.com/7.x/bottts/svg?seed=${agent.name}`} />
                    <AvatarFallback>AI</AvatarFallback>
                  </>
                ) : (
                  <AvatarFallback><User className="w-4 h-4" /></AvatarFallback>
                )}
              </Avatar>

              {/* 气泡 */}
              {msg.role === 'assistant' ? (
                <div className="flex-1 min-w-0">
                  <AIResponseBubble parts={parseMessageContent(msg.content)} />
                  <div className="text-[10px] mt-1 opacity-70 text-muted-foreground text-left ml-1">
                    {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              ) : (
                <div className="relative max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed shadow-sm bg-primary text-primary-foreground rounded-tr-sm">
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                  <div className="text-[10px] mt-1 opacity-70 text-right text-primary-foreground/80">
                    {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              )}
            </div>
          ))}

          {isTyping && (
            <div className="flex gap-3">
               <Avatar className="w-8 h-8 border shadow-sm">
                  <AvatarImage src={`https://api.dicebear.com/7.x/bottts/svg?seed=${agent.name}`} />
                  <AvatarFallback>AI</AvatarFallback>
               </Avatar>
               <div className="bg-muted/50 border border-border px-4 py-3 rounded-2xl rounded-tl-sm flex items-center gap-1">
                 <span className="w-1.5 h-1.5 bg-muted-foreground/40 rounded-full animate-bounce [animation-delay:-0.3s]" />
                 <span className="w-1.5 h-1.5 bg-muted-foreground/40 rounded-full animate-bounce [animation-delay:-0.15s]" />
                 <span className="w-1.5 h-1.5 bg-muted-foreground/40 rounded-full animate-bounce" />
               </div>
            </div>
          )}
          <div ref={scrollRef} />
        </div>
      </ScrollArea>

      {/* 输入区域 */}
      <div className="p-4 border-t bg-background/80 backdrop-blur">
        <div className="max-w-3xl mx-auto relative flex gap-2">
          <Input 
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && void handleSendMessage()}
            placeholder={t("input.placeholder", { name: agent.name })}
            className="rounded-full pl-4 pr-12 py-6 shadow-sm border-muted-foreground/20 focus-visible:ring-1"
            autoFocus
            disabled={isInputDisabled}
          />
          <Button 
            size="icon" 
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full h-8 w-8"
            onClick={() => void handleSendMessage()}
            disabled={!inputValue.trim() || isInputDisabled}
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
        {errorMessage ? (
          <div className="text-center mt-2 text-xs text-red-500/80">
            {errorMessage}
          </div>
        ) : null}
        <div className="text-center mt-2 text-xs text-muted-foreground/50">
          {t("footer.disclaimer")}
        </div>
      </div>
    </div>
  )
}
