"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { Download, Star, Plus, Play, Sparkles, Pencil, Trash2 } from "lucide-react"
import { useTranslations } from "next-intl"
import { Badge } from "@/ui/shadcn/badge"
import { Button } from "@/ui/shadcn/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/shadcn/alert-dialog"
import { CardContent, CardFooter, CardHeader } from "@/ui/shadcn/card"
import { Dialog, DialogTrigger } from "@/ui/shadcn/dialog"
import { Avatar, AvatarFallback, AvatarImage } from "@/ui/shadcn/avatar"
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/shadcn/popover"
import { Switch } from "@/ui/shadcn/switch"
import { Label } from "@/ui/shadcn/label"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { getIconComponent } from "@/lib/constants/provider-icons"
import { getAssistantStatusLabel } from "./assistant-status"
import type { AssistantCardData } from "./types"

const AgentModalContent = dynamic(
  () => import("./agent-modal-content").then((mod) => mod.AgentModalContent),
  { ssr: false }
)

interface AgentCardProps {
  agent: AssistantCardData
  onInstall?: (assistantId: string, options?: { followLatest?: boolean }) => Promise<void>
  onPreview?: (assistantId: string, message: string) => Promise<string>
  onEdit?: (assistantId: string) => void
  onDelete?: (assistantId: string) => Promise<void>
}

const formatCount = (count: number) => {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}m`
  if (count >= 10000) return `${Math.round(count / 1000)}k`
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`
  return `${count}`
}

export function AgentCard({ agent, onInstall, onPreview, onEdit, onDelete }: AgentCardProps) {
  const t = useTranslations("assistants")
  const isInstalled = agent.installed
  const [isInstalling, setIsInstalling] = React.useState(false)
  const [isDeleting, setIsDeleting] = React.useState(false)
  const [detailsOpen, setDetailsOpen] = React.useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)
  const [followLatest, setFollowLatest] = React.useState(true)
  const [openPopover, setOpenPopover] = React.useState(false)
  const canManage = Boolean(agent.isOwned && (onEdit || onDelete))
  const statusKey =
    agent.isOwned && agent.visibility && agent.status
      ? getAssistantStatusLabel(agent.visibility, agent.status)
      : null
  
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

  const handleDelete = async (event?: React.MouseEvent) => {
    event?.stopPropagation()
    if (!onDelete || isDeleting) return

    setIsDeleting(true)
    try {
      await onDelete(agent.id)
      toast.success(t("toast.assistantDeletedTitle"), {
        description: t("toast.assistantDeletedDesc", { name: agent.name }),
      })
      setDeleteDialogOpen(false)
    } catch {
      toast.error(t("toast.deleteFailedTitle"), {
        description: t("toast.deleteFailedDesc"),
      })
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
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
                {statusKey ? (
                  <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                    {t(`status.${statusKey}`)}
                  </Badge>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                {/* 这里的 DialogTrigger 触发详情预览 */}
                <DialogTrigger asChild>
                   <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-primary transition-colors">
                      <Play size={16} /> {/* 试用图标 */}
                   </Button>
                </DialogTrigger>
              </div>
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
           
           {canManage ? (
             <div className="flex items-center gap-2">
               {onEdit ? (
                 <Button
                   size="sm"
                   variant="outline"
                   className="h-8 rounded-full px-3 text-xs font-medium"
                   onClick={(event) => {
                     event.stopPropagation()
                     onEdit(agent.id)
                   }}
                 >
                   <Pencil size={14} />
                   {t("actions.edit")}
                 </Button>
               ) : null}
               {onDelete ? (
                 <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                   <Button
                     size="sm"
                     variant="ghost"
                     className="h-8 rounded-full px-3 text-xs font-medium text-destructive hover:bg-destructive/10 hover:text-destructive"
                     onClick={(event) => {
                       event.stopPropagation()
                       setDeleteDialogOpen(true)
                     }}
                   >
                     <Trash2 size={14} />
                     {t("edit.delete")}
                   </Button>
                   <AlertDialogContent>
                     <AlertDialogHeader>
                       <AlertDialogTitle>{t("edit.deleteConfirmTitle")}</AlertDialogTitle>
                       <AlertDialogDescription>
                         {t("edit.deleteConfirmDesc", { name: agent.name })}
                       </AlertDialogDescription>
                     </AlertDialogHeader>
                     <AlertDialogFooter>
                       <AlertDialogCancel>{t("edit.deleteConfirmCancel")}</AlertDialogCancel>
                       <AlertDialogAction asChild>
                         <Button
                           type="button"
                           variant="destructive"
                           onClick={handleDelete}
                           disabled={isDeleting}
                         >
                           {isDeleting ? t("edit.deleting") : t("edit.deleteConfirmAction")}
                         </Button>
                       </AlertDialogAction>
                     </AlertDialogFooter>
                   </AlertDialogContent>
                 </AlertDialog>
               ) : null}
             </div>
           ) : !isInstalled ? (
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
           ) : null}
        </CardFooter>

      </div>

      {/* 详情弹窗内容 */}
      {detailsOpen ? (
        <AgentModalContent agent={agent} onInstall={onInstall} onPreview={onPreview} />
      ) : null}
    </Dialog>
  )
}
