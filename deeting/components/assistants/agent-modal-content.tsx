"use client"

import * as React from "react"
import { Send, Check, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DialogContent } from "@/components/ui/dialog"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useMarketStore, type Agent } from "@/store/market-store"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

interface AgentModalContentProps {
  agent: Agent
}

export function AgentModalContent({ agent }: AgentModalContentProps) {
  const installAgent = useMarketStore((state) => state.installAgent)
  const isInstalled = useMarketStore((state) => state.isInstalled(agent.id))
  const [inputValue, setInputValue] = React.useState("")
  const [messages, setMessages] = React.useState<{role: 'user' | 'assistant', content: string}[]>([
    { role: 'assistant', content: `你好！我是${agent.name}。${agent.desc} 有什么我可以帮你的吗？` }
  ])

  const handleSendMessage = () => {
    if (!inputValue.trim()) return
    
    // 添加用户消息
    setMessages(prev => [...prev, { role: 'user', content: inputValue }])
    const currentInput = inputValue
    setInputValue("")

    // 模拟回复延迟
    setTimeout(() => {
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: `[模拟回复] 针对 "${currentInput}"，${agent.name} 会给出专业的建议。这是一个预览模式。` 
      }])
    }, 1000)
  }

  const handleInstall = () => {
    if (isInstalled) return
    installAgent(agent)
    toast.success(`${agent.name} 已就绪`, {
      description: "该助手已添加到您的侧边栏",
      icon: <Sparkles className="w-4 h-4 text-yellow-400" />,
    })
  }

  return (
    <DialogContent className="max-w-4xl h-[80vh] flex p-0 overflow-hidden rounded-2xl gap-0 border-none sm:max-w-4xl">
         {/* 左侧：信息区 */}
         <div className="w-1/3 bg-muted/30 p-6 border-r flex flex-col hidden md:flex">
            <div className={cn("w-16 h-16 rounded-xl bg-gradient-to-r mb-4 shrink-0", agent.color)} />
            <h2 className="text-2xl font-bold">{agent.name}</h2>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{agent.desc}</p>
            
            <div className="mt-6 space-y-4">
              <div className="text-sm font-medium text-foreground/80">能力标签</div>
              <div className="flex flex-wrap gap-2">
                {agent.tags.map(tag => (
                  <span key={tag} className="text-xs bg-background border px-2 py-1 rounded-md text-muted-foreground">
                    #{tag}
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-auto pt-6">
               <Button 
                 onClick={handleInstall}
                 disabled={isInstalled}
                 className={cn("w-full transition-all", isInstalled && "bg-green-600 hover:bg-green-700")}
               >
                  {isInstalled ? (
                    <><Check className="mr-2 h-4 w-4" /> 已添加到侧边栏</>
                  ) : (
                    "确认安装到侧边栏"
                  )}
               </Button>
            </div>
         </div>
         
         {/* 右侧：Playground */}
         <div className="flex-1 bg-background flex flex-col relative w-full">
            <div className="p-4 border-b text-center text-sm text-muted-foreground bg-background/80 backdrop-blur absolute w-full top-0 z-10 flex items-center justify-center">
               <Sparkles className="w-3 h-3 mr-2 text-primary" /> Preview Mode
            </div>
            
            <ScrollArea className="flex-1 p-0 pt-16">
              <div className="p-6 space-y-4">
                {messages.map((msg, index) => (
                   <div key={index} className={cn("flex gap-3", msg.role === 'user' ? "flex-row-reverse" : "")}>
                      <Avatar className="w-8 h-8 shrink-0">
                        {msg.role === 'assistant' ? (
                          <>
                             <AvatarImage src={`https://api.dicebear.com/7.x/bottts/svg?seed=${agent.name}`} />
                             <AvatarFallback>AI</AvatarFallback>
                          </>
                        ) : (
                          <AvatarFallback>U</AvatarFallback>
                        )}
                      </Avatar>
                      <div className={cn(
                        "p-3 rounded-2xl text-sm max-w-[80%]", 
                        msg.role === 'assistant' 
                          ? "bg-muted rounded-tl-none" 
                          : "bg-primary text-primary-foreground rounded-tr-none"
                      )}>
                         {msg.content}
                      </div>
                   </div>
                ))}
              </div>
            </ScrollArea>

            <div className="p-4 border-t bg-background">
               <div className="relative">
                 <Input 
                   value={inputValue}
                   onChange={(e) => setInputValue(e.target.value)}
                   onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                   placeholder={`试着和 ${agent.name} 聊聊...`} 
                   className="rounded-full pr-12" 
                 />
                 <Button 
                   size="icon" 
                   variant="ghost" 
                   onClick={handleSendMessage}
                   className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 text-muted-foreground hover:text-primary"
                 >
                   <Send className="h-4 w-4" />
                 </Button>
               </div>
            </div>
         </div>
    </DialogContent>
  )
}
