"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { getIconComponent } from "@/lib/constants/provider-icons"
import type { AssistantInstallItem } from "@/lib/api/assistants"
import { cn } from "@/lib/utils"

interface InstalledAssistantCardProps {
  item: AssistantInstallItem
  isUpdating?: boolean
  onToggleFollowLatest: (assistantId: string, nextValue: boolean) => void
}

const normalizeTags = (tags: string[] = []) =>
  tags
    .map((tag) => tag.replace(/^#/, "").trim())
    .filter(Boolean)

export function InstalledAssistantCard({
  item,
  isUpdating = false,
  onToggleFollowLatest,
}: InstalledAssistantCardProps) {
  const t = useTranslations("assistants")
  const version = item.assistant.version
  const description = item.assistant.summary || version.description || ""
  const tags = normalizeTags(item.assistant.tags.length ? item.assistant.tags : version.tags)
  const followLatest = item.follow_latest ?? true
  const iconId = item.assistant.icon_id || "lucide:bot"
  const Icon = getIconComponent(iconId)
  const isImageIcon = iconId.startsWith("http") || iconId.startsWith("data:")

  return (
    <Card className="border border-border/60 shadow-sm">
      <CardHeader className="space-y-2">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <Avatar className={cn("h-10 w-10 rounded-xl bg-muted/40")}>
              {isImageIcon ? <AvatarImage src={iconId} /> : null}
              <AvatarFallback className="rounded-xl">
                {Icon ? <Icon className="h-4 w-4" /> : "AI"}
              </AvatarFallback>
            </Avatar>
            <div className="space-y-1">
              <CardTitle className="text-base">{version.name}</CardTitle>
              <CardDescription className="line-clamp-2 text-sm">
                {description}
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">
              {t("modal.followLatestLabel")}
            </Label>
            <Switch
              checked={followLatest}
              onCheckedChange={(checked) => onToggleFollowLatest(item.assistant_id, checked)}
              disabled={isUpdating}
              aria-label={t("modal.followLatestLabel")}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2 pt-0">
        <Badge variant="secondary" className="text-[10px] px-2 py-0.5">
          v{version.version}
        </Badge>
        {tags.map((tag) => (
          <Badge key={tag} variant="outline" className="text-[10px] px-2 py-0.5">
            #{tag}
          </Badge>
        ))}
      </CardContent>
    </Card>
  )
}
