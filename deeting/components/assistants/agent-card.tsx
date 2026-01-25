"use client"

import * as React from "react"
import { Download, Star, Plus, Play, Sparkles } from "lucide-react"
import { useTranslations } from "next-intl"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import { Dialog, DialogTrigger } from "@/components/ui/dialog"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { getIconComponent } from "@/lib/constants/provider-icons"
import { AgentModalContent } from "./agent-modal-content"
import type { AssistantCardData } from "./types"

interface AgentCardProps {
  agent: AssistantCardData
  onInstall?: (assistantId: string, options?: { followLatest?: boolean }) => Promise<void>
  onPreview?: (assistantId: string, message: string) => Promise<string>
}

const formatCount = (count: number) => {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}m`
  if (count >= 10000) return `${Math.round(count / 1000)}k`
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`
  return `${count}`
}

export function AgentCard({ agent, onInstall, onPreview }: AgentCardProps) {
  const t = useTranslations("assistants")
  const isInstalled = agent.installed
  const [isInstalling, setIsInstalling] = React.useState(false)
  const [followLatest, setFollowLatest] = React.useState(true)
  const [openPopover, setOpenPopover] = React.useState(false)
  
  const Icon = getIconComponent(agent.iconId || "lucide:bot")
  const isImageIcon = Boolean(
    agent.iconId && (agent.iconId.startsWith("http") || agent.iconId.startsWith("data:"))
  )

  const handleInstallClick = async (e?: React.MouseEvent) => {
    e?.stopPropagation()
    if (isInstalled || !onInstall) return

    setOpenPopover(false)
    setIsInstalling(true)
    try {
      await onInstall(agent.id, { followLatest })
      toast.success(t("toast.installedTitle", { name: agent.name }), {
        description: t("toast.installedDesc"),
        icon: <Sparkles className="w-4 h-4 text-yellow-400" />,
      })
    } catch (error) {
      toast.error(t("toast.installFailedTitle"), {
        description: t("toast.installFailedDesc"),
      })
    } finally {
      setIsInstalling(false)
    }
  }

  return (
    <Dialog>
      <div className="group relative transition-all duration-300 hover:-translate-y-1 hover:shadow-xl rounded-xl bg-white dark:bg-zinc-900 border border-border overflow-hidden flex flex-col h-full">
        
        {/* 卡片顶部渐变装饰 */}
        <div className={cn("h-24 bg-gradient-to-r opacity-80 relative transition-opacity group-hover:opacity-100", agent.color)}>
           <div className="absolute -bottom-6 left-4">
              <Avatar className="w-16 h-16 border-4 border-white dark:border-zinc-900 shadow-md">
                 {isImageIcon ? <AvatarImage src={agent.iconId || ""} /> : null}
                 <AvatarFallback>
                   {Icon ? <Icon className="h-6 w-6" /> : "AI"}
                 </AvatarFallback>
              </Avatar>
           </div>
        </div>

        <CardHeader className="pt-8 pb-2 px-4">
           <div className="flex justify-between items-start">
              <div className="space-y-1">
                <h3 className="font-bold text-lg leading-none">{agent.name}</h3>
                <p className="text-xs text-muted-foreground">
                  {t("card.by", { author: agent.author || t("author.community") })}
                </p>
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
           <p className="text-sm text-muted-foreground line-clamp-2 min-h-[2.5rem]">{agent.description}</p>
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
              <span className="flex items-center gap-1"><Download size={12}/> {formatCount(agent.installCount)}</span>
              <span className="flex items-center gap-1"><Star size={12} className="text-yellow-500 fill-yellow-500"/> {agent.ratingAvg.toFixed(1)}</span>
           </div>
           
           {/* 安装按钮 */}
           {isInstalled ? (
             <Button 
               size="sm" 
               disabled
               className="rounded-full px-4 h-8 text-xs font-bold bg-green-600 text-white"
             >
                {t("card.installed")}
             </Button>
           ) : (
             <Popover open={openPopover} onOpenChange={setOpenPopover}>
               <PopoverTrigger asChild>
                  <Button 
                    size="sm" 
                    onClick={(e) => e.stopPropagation()}
                    disabled={isInstalling || !onInstall}
                    className="rounded-full px-4 h-8 text-xs font-bold shadow-lg transition-all duration-300"
                  >
                     {isInstalling ? t("card.adding") : (
                       <><Plus size={14} className="mr-1" /> {t("card.install")}</>
                     )}
                  </Button>
               </PopoverTrigger>
               <PopoverContent className="w-72 p-4" align="end" onClick={(e) => e.stopPropagation()}>
                  <div className="space-y-4">
                    <div className="flex items-start justify-between gap-4">
                       <div className="space-y-1">
                          <Label htmlFor="follow-latest" className="font-medium">
                            {t("modal.followLatestLabel")}
                          </Label>
                          <p className="text-xs text-muted-foreground">
                            {t("modal.followLatestDesc")}
                          </p>
                       </div>
                       <Switch 
                         id="follow-latest" 
                         checked={followLatest} 
                         onCheckedChange={setFollowLatest} 
                       />
                    </div>
                    <Button onClick={handleInstallClick} className="w-full" size="sm">
                       {t("card.install")}
                    </Button>
                  </div>
               </PopoverContent>
             </Popover>
           )}
        </CardFooter>

      </div>

      {/* 详情弹窗内容 */}
      <AgentModalContent agent={agent} onInstall={onInstall} onPreview={onPreview} />
    </Dialog>
  )
}
