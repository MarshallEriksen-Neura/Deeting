"use client"

import * as React from "react"
import { use } from "react"
import { useRouter } from "next/navigation"
import { Send, Bot, User, Sparkles, ArrowLeft } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useMarketStore } from "@/store/market-store"
import { cn } from "@/lib/utils"

interface ChatPageProps {
  params: Promise<{ agentId: string }>
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
}

export default function AgentChatPage({ params }: ChatPageProps) {
  // Unwrap params using React.use()
  const { agentId } = use(params)
  
  const router = useRouter()
  const installedAgents = useMarketStore((state) => state.installedAgents)
  const agent = installedAgents.find(a => a.id === agentId)

  // 简单的本地消息状态
  const [messages, setMessages] = React.useState<Message[]>([])
  const [inputValue, setInputValue] = React.useState("")
  const [isTyping, setIsTyping] = React.useState(false)
  const scrollRef = React.useRef<HTMLDivElement>(null)

  // 初始问候语
  React.useEffect(() => {
    if (agent && messages.length === 0) {
      setMessages([
        {
          id: 'init',
          role: 'assistant',
          content: `你好！我是 **${agent.name}**。\n${agent.desc}\n\n准备好开始协作了吗？`,
          createdAt: Date.now()
        }
      ])
    }
  }, [agent, messages.length])

  // 自动滚动到底部
  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, isTyping])

  if (!agent) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-60px)] space-y-4">
        <div className="bg-muted p-4 rounded-full">
          <Bot className="w-8 h-8 text-muted-foreground" />
        </div>
        <h1 className="text-xl font-bold">未找到该助手</h1>
        <p className="text-muted-foreground">该助手可能未安装或已移除。</p>
        <Button onClick={() => router.push('/assistants')}>
          前往助手市场
        </Button>
      </div>
    )
  }

  const handleSendMessage = () => {
    if (!inputValue.trim()) return

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: inputValue,
      createdAt: Date.now()
    }

    setMessages(prev => [...prev, userMsg])
    setInputValue("")
    setIsTyping(true)

    // 模拟 AI 回复
    setTimeout(() => {
      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `[${agent.name} 正在思考...]\n\n这是一个模拟回复。在真实场景中，这里会调用 LLM API，根据 "${agent.systemPrompt || '系统提示词'}" 进行回答。\n\n针对你的输入: "${userMsg.content}"`,
        createdAt: Date.now()
      }
      setMessages(prev => [...prev, aiMsg])
      setIsTyping(false)
    }, 1500)
  }

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
              Online
            </div>
          </div>
        </div>
        <Button variant="ghost" size="icon">
           <Sparkles className="w-4 h-4 text-muted-foreground" />
        </Button>
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
              <div
                className={cn(
                  "relative max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed shadow-sm",
                  msg.role === 'user'
                    ? "bg-primary text-primary-foreground rounded-tr-sm"
                    : "bg-muted/50 border border-border rounded-tl-sm"
                )}
              >
                <div className="whitespace-pre-wrap">{msg.content}</div>
                <div className={cn(
                  "text-[10px] mt-1 opacity-70 text-right",
                  msg.role === 'user' ? "text-primary-foreground/80" : "text-muted-foreground"
                )}>
                  {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
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
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
            placeholder={`Message ${agent.name}...`}
            className="rounded-full pl-4 pr-12 py-6 shadow-sm border-muted-foreground/20 focus-visible:ring-1"
            autoFocus
          />
          <Button 
            size="icon" 
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full h-8 w-8"
            onClick={handleSendMessage}
            disabled={!inputValue.trim()}
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
        <div className="text-center mt-2 text-xs text-muted-foreground/50">
          AI generated content may be inaccurate.
        </div>
      </div>
    </div>
  )
}
