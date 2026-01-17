"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, Bot, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectGroup,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import type { ModelGroup } from "@/lib/api/models"
import type { ChatAssistant } from "@/store/chat-store"
import { useI18n } from "@/hooks/use-i18n"

interface ChatHeaderProps {
  agent: ChatAssistant
  modelGroups: ModelGroup[]
  selectedModelId: string | null
  onModelChange: (modelId: string) => void
  streamEnabled: boolean
  onStreamChange: (enabled: boolean) => void
  isLoadingModels: boolean
}

export function ChatHeader({
  agent,
  modelGroups,
  selectedModelId,
  onModelChange,
  streamEnabled,
  onStreamChange,
  isLoadingModels,
}: ChatHeaderProps) {
  const router = useRouter()
  const t = useI18n("chat")

  return (
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
            onValueChange={onModelChange}
            disabled={isLoadingModels || modelGroups.length === 0}
          >
            <SelectTrigger className="h-7 w-[200px] border-0 bg-transparent text-xs shadow-none focus:ring-0">
              <SelectValue placeholder={t("model.placeholder")} />
            </SelectTrigger>
            <SelectContent>
              {modelGroups.map((group) => (
                <SelectGroup key={group.instance_id}>
                  <SelectLabel className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    {group.instance_name}
                  </SelectLabel>
                  {group.models.map((model) => {
                    const modelValue = model.provider_model_id ?? model.id
                    return (
                      <SelectItem key={modelValue} value={modelValue}>
                        <div className="flex flex-col">
                          <span className="text-xs font-medium text-foreground">{model.id}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {group.provider || model.owned_by || "provider"}
                          </span>
                        </div>
                      </SelectItem>
                    )
                  })}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2 rounded-full bg-white/70 dark:bg-white/10 px-3 py-1 shadow-sm ring-1 ring-black/5 dark:ring-white/10 backdrop-blur">
          <Label className="text-xs text-muted-foreground">{t("header.stream")}</Label>
          <Switch checked={streamEnabled} onCheckedChange={onStreamChange} />
          <span className="text-[10px] text-muted-foreground/70">
            {streamEnabled ? t("header.streamOn") : t("header.streamOff")}
          </span>
        </div>
        <Button variant="ghost" size="icon">
          <Sparkles className="w-4 h-4 text-muted-foreground" />
        </Button>
      </div>
    </header>
  )
}
