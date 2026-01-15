"use client"

import * as React from "react"
import { Download, Star, Plus, Play, Sparkles } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import { useMarketStore, type Agent } from "@/store/market-store"
import { toast } from "sonner"
import { AgentModalContent } from "./agent-modal-content"

interface AgentCardProps {
  agent: Agent
}

export function AgentCard({ agent }: AgentCardProps) {
  const installAgent = useMarketStore((state) => state.installAgent)
  const isInstalled = useMarketStore((state) => state.isInstalled(agent.id))
  const [isInstalling, setIsInstalling] = React.useState(false)

  const handleInstall = (e: React.MouseEvent) => {
    e.stopPropagation() // 防止触发 Dialog
    if (isInstalled) return

    setIsInstalling(true)
    
    // 模拟安装延迟和动效
    setTimeout(() => {
      installAgent(agent)
      setIsInstalling(false)
      toast.success(`${agent.name} 已就绪`, {
        description: "该助手已添加到您的侧边栏",
        icon: <Sparkles className="w-4 h-4 text-yellow-400" />,
      })
    }, 800)
  }

  return (
    <Dialog>
      <div className="group relative transition-all duration-300 hover:-translate-y-1 hover:shadow-xl rounded-xl bg-white dark:bg-zinc-900 border border-border overflow-hidden flex flex-col h-full">
        
        {/* 卡片顶部渐变装饰 */}
        <div className={cn("h-24 bg-gradient-to-r opacity-80 relative transition-opacity group-hover:opacity-100", agent.color)}>
           <div className="absolute -bottom-6 left-4">
              <Avatar className="w-16 h-16 border-4 border-white dark:border-zinc-900 shadow-md">
                 <AvatarImage src={`https://api.dicebear.com/7.x/bottts/svg?seed=${agent.name}`} />
                 <AvatarFallback>AI</AvatarFallback>
              </Avatar>
           </div>
        </div>

        <CardHeader className="pt-8 pb-2 px-4">
           <div className="flex justify-between items-start">
              <div className="space-y-1">
                <h3 className="font-bold text-lg leading-none">{agent.name}</h3>
                <p className="text-xs text-muted-foreground">by {agent.author}</p>
              </div>
              {/* 这里的 DialogTrigger 触发详情预览 */}
              <DialogTrigger asChild>
                 <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-primary transition-colors">
                    <Play size={16} /> {/* 试用图标 */}
                 </Button>
              </DialogTrigger>
           </div>
        </CardHeader>

        <CardContent className="px-4 py-2 flex-1">
           <p className="text-sm text-muted-foreground line-clamp-2 min-h-[2.5rem]">{agent.desc}</p>
           <div className="flex flex-wrap gap-1 mt-3">
              {agent.tags.map(tag => (
                 <Badge key={tag} variant="secondary" className="text-[10px] px-2 py-0.5 font-normal">
                   #{tag}
                 </Badge>
              ))}
           </div>
        </CardContent>

        <CardFooter className="px-4 py-4 border-t bg-muted/30 flex justify-between items-center mt-auto">
           <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono">
              <span className="flex items-center gap-1"><Download size={12}/> {agent.installs}</span>
              <span className="flex items-center gap-1"><Star size={12} className="text-yellow-500 fill-yellow-500"/> {agent.rating}</span>
           </div>
           
           {/* 安装按钮 */}
           <Button 
             size="sm" 
             onClick={handleInstall}
             disabled={isInstalled || isInstalling}
             className={cn(
               "rounded-full px-4 h-8 text-xs font-bold transition-all duration-300",
               isInstalled 
                 ? "bg-green-600 hover:bg-green-700 text-white" 
                 : "shadow-lg"
             )}
           >
              {isInstalling ? (
                <>Adding...</>
              ) : isInstalled ? (
                <>Installed</>
              ) : (
                <><Plus size={14} className="mr-1" /> Install</>
              )}
           </Button>
        </CardFooter>

      </div>

      {/* 详情弹窗内容 */}
      <AgentModalContent agent={agent} />
    </Dialog>
  )
}
