"use client"

import * as React from "react"
import { Send, Check, Sparkles } from "lucide-react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DialogContent } from "@/components/ui/dialog"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { previewAssistant } from "@/lib/api"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { getIconComponent } from "@/lib/constants/provider-icons"
import type { AssistantCardData } from "./types"

interface AgentModalContentProps {
  agent: AssistantCardData
  onInstall?: (assistantId: string, options?: { followLatest?: boolean }) => Promise<void>
  onPreview?: (assistantId: string, message: string) => Promise<string>
}

const normalizePreviewContent = (content: unknown) => {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .map((item) => (typeof item === "string" ? item : JSON.stringify(item)))
      .join("\n")
  }
  if (content == null) return ""
  return JSON.stringify(content)
}

export function AgentModalContent({ agent, onInstall, onPreview }: AgentModalContentProps) {
  const t = useTranslations("assistants")
  const isInstalled = agent.installed
  const [inputValue, setInputValue] = React.useState("")
  const [isSending, setIsSending] = React.useState(false)
  const [followLatest, setFollowLatest] = React.useState(true)
  const Icon = getIconComponent(agent.iconId || "lucide:bot")
  const isImageIcon = Boolean(
    agent.iconId && (agent.iconId.startsWith("http") || agent.iconId.startsWith("data:"))
  )
  const greeting = React.useMemo(
    () => t("preview.greeting", { name: agent.name, description: agent.description || "" }),
    [agent.description, agent.name, t]
  )
  const [messages, setMessages] = React.useState<{role: 'user' | 'assistant', content: string}[]>([
    { role: 'assistant', content: greeting }
  ])

  React.useEffect(() => {
    setMessages([{ role: "assistant", content: greeting }])
    setInputValue("")
    setFollowLatest(true)
  }, [agent.id, greeting])

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isSending) return
    
    // 添加用户消息
    setMessages(prev => [...prev, { role: 'user', content: inputValue }])
    const currentInput = inputValue
    setInputValue("")
    setIsSending(true)

    try {
      if (onPreview) {
        const reply = await onPreview(agent.id, currentInput)
        setMessages(prev => [...prev, { role: 'assistant', content: reply || t("preview.emptyReply") }])
      } else {
        const response = await previewAssistant(agent.id, { message: currentInput })
        const content = normalizePreviewContent(response?.choices?.[0]?.message?.content)
        setMessages(prev => [...prev, { role: 'assistant', content: content || t("preview.emptyReply") }])
      }
    } catch (error) {
      toast.error(t("toast.previewFailedTitle"), {
        description: t("toast.previewFailedDesc"),
      })
      setMessages(prev => [...prev, { role: 'assistant', content: t("toast.previewUnavailable") }])
    } finally {
      setIsSending(false)
    }
  }

  const handleInstall = async () => {
    if (isInstalled || !onInstall) return
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
    }
  }

  return (
    <DialogContent className="max-w-4xl h-[80vh] flex p-0 overflow-hidden rounded-2xl gap-0 border-none sm:max-w-4xl">
         {/* 左侧：信息区 */}
         <div className="w-1/3 bg-muted/30 p-6 border-r flex flex-col hidden md:flex">
            <Avatar className={cn("w-16 h-16 rounded-xl mb-4 bg-gradient-to-r", agent.color)}>
              {isImageIcon ? <AvatarImage src={agent.iconId || ""} /> : null}
              <AvatarFallback className="rounded-xl">
                {Icon ? <Icon className="h-6 w-6" /> : "AI"}
              </AvatarFallback>
            </Avatar>
            <h2 className="text-2xl font-bold">{agent.name}</h2>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{agent.description}</p>
            
            <div className="mt-6 space-y-4">
              <div className="text-sm font-medium text-foreground/80">{t("modal.tagsTitle")}</div>
              <div className="flex flex-wrap gap-2">
                {agent.tags.map(tag => (
                  <span key={tag} className="text-xs bg-background border px-2 py-1 rounded-md text-muted-foreground">
                    #{tag}
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-4 rounded-lg border bg-background/70 p-3 space-y-2">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <Label className="text-sm font-medium">{t("modal.followLatestLabel")}</Label>
                  <p className="text-xs text-muted-foreground">{t("modal.followLatestDesc")}</p>
                </div>
                <Switch
                  checked={followLatest}
                  onCheckedChange={setFollowLatest}
                  aria-label={t("modal.followLatestLabel")}
                  disabled={isInstalled || !onInstall}
                />
              </div>
            </div>

            <div className="mt-auto pt-6">
               <Button 
                 onClick={handleInstall}
                 disabled={isInstalled || !onInstall}
                 className={cn("w-full transition-all", isInstalled && "bg-green-600 hover:bg-green-700")}
               >
                  {isInstalled ? (
                    <><Check className="mr-2 h-4 w-4" /> {t("modal.installedButton")}</>
                  ) : (
                    t("modal.installButton")
                  )}
               </Button>
            </div>
         </div>
         
         {/* 右侧：Playground */}
         <div className="flex-1 bg-background flex flex-col relative w-full">
            <div className="p-4 border-b text-center text-sm text-muted-foreground bg-background/80 backdrop-blur absolute w-full top-0 z-10 flex items-center justify-center">
               <Sparkles className="w-3 h-3 mr-2 text-primary" /> {t("modal.previewMode")}
            </div>
            
            <ScrollArea className="flex-1 p-0 pt-16">
              <div className="p-6 space-y-4">
                {messages.map((msg, index) => (
                   <div key={index} className={cn("flex gap-3", msg.role === 'user' ? "flex-row-reverse" : "")}>
                      <Avatar className="w-8 h-8 shrink-0">
                        {msg.role === 'assistant' ? (
                          <>
                             {isImageIcon ? <AvatarImage src={agent.iconId || ""} /> : null}
                             <AvatarFallback>
                               {Icon ? <Icon className="h-4 w-4" /> : "AI"}
                             </AvatarFallback>
                          </>
                        ) : (
                          <AvatarFallback>U</AvatarFallback>
                        )}
                      </Avatar>
                      <div className={cn(
                        "p-3 rounded-2xl text-sm max-w-[88%]", 
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
                   placeholder={t("modal.inputPlaceholder", { name: agent.name })} 
                   className="rounded-full pr-12" 
                 />
                 <Button 
                   size="icon" 
                   variant="ghost" 
                   onClick={handleSendMessage}
                   disabled={isSending}
                   className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 text-muted-foreground hover:text-primary"
                 >
                   <Send className={cn("h-4 w-4", isSending && "opacity-60")} />
                 </Button>
               </div>
            </div>
         </div>
    </DialogContent>
  )
}
