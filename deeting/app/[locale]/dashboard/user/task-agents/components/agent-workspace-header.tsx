"use client"

import { Save, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  GlassCardDescription,
  GlassCardHeader,
  GlassCardTitle,
} from "@/components/ui/glass-card"
import type { CustomTaskAgentProfile } from "@/lib/api/custom-task-agents"

type Translation = (key: string, values?: Record<string, string | number>) => string

type AgentWorkspaceHeaderProps = {
  t: Translation
  selectedAgent: CustomTaskAgentProfile | null
  isStarterState: boolean
  isImageWorkspace: boolean
  isVoiceWorkspace: boolean
  isSaving: boolean
  saveDisabled: boolean
  dateFormatter: Intl.DateTimeFormat
  onDelete: () => void
  onSave: () => void
}

export function AgentWorkspaceHeader({
  t,
  selectedAgent,
  isStarterState,
  isImageWorkspace,
  isVoiceWorkspace,
  isSaving,
  saveDisabled,
  dateFormatter,
  onDelete,
  onSave,
}: AgentWorkspaceHeaderProps) {
  const title = selectedAgent
    ? selectedAgent.name
    : isStarterState
      ? t("starter.title")
      : isImageWorkspace
        ? t("editor.imageWorkspace.title")
        : isVoiceWorkspace
          ? t("editor.voiceWorkspace.title")
          : t("editor.chatWorkspace.title")

  const description = selectedAgent
    ? t("editor.updatedAt", {
        value: dateFormatter.format(new Date(selectedAgent.updated_at)),
      })
    : isStarterState
      ? t("starter.description")
      : isImageWorkspace
        ? t("editor.imageWorkspace.description")
        : isVoiceWorkspace
          ? t("editor.voiceWorkspace.description")
          : t("editor.chatWorkspace.description")

  return (
    <GlassCardHeader className="space-y-3 pb-0">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-1.5">
          {/* Title row */}
          <div className="flex flex-wrap items-center gap-2">
            <GlassCardTitle className="text-[17px] font-semibold tracking-[-0.01em]">
              {title}
            </GlassCardTitle>
            {selectedAgent ? (
              <>
                <Badge
                  variant="secondary"
                  className="rounded-md px-1.5 py-0 text-[10px] font-medium capitalize leading-[18px]"
                >
                  {selectedAgent.invocation_kind === "chat"
                    ? t("badges.chat")
                    : selectedAgent.invocation_kind === "image_generation"
                      ? t("badges.imageGeneration")
                      : t("badges.textToSpeech")}
                </Badge>
                <Badge
                  className={cn(
                    "rounded-md px-1.5 py-0 text-[10px] font-medium leading-[18px]",
                    selectedAgent.is_enabled
                      ? "border-emerald-500/20 bg-emerald-500/8 text-emerald-400"
                      : "border-white/8 bg-white/4 text-[var(--muted)]",
                  )}
                >
                  {selectedAgent.is_enabled ? t("badges.enabled") : t("badges.disabled")}
                </Badge>
              </>
            ) : (
              <Badge className="rounded-md border-[var(--primary)]/20 bg-[var(--primary)]/8 px-1.5 py-0 text-[10px] font-medium leading-[18px] text-[var(--primary)]">
                {t("editor.draft")}
              </Badge>
            )}
          </div>

          {/* Description */}
          <GlassCardDescription className="text-[12px]">
            {description}
          </GlassCardDescription>
        </div>

        {/* Action buttons */}
        <div className="flex shrink-0 items-center gap-2">
          {selectedAgent ? (
            <Button
              variant="outline"
              size="sm"
              onClick={onDelete}
              disabled={isSaving}
              className="h-8 rounded-lg border-white/8 text-[12px] text-red-400 hover:border-red-500/20 hover:bg-red-500/8 hover:text-red-300"
            >
              <Trash2 className="mr-1.5 size-3.5" />
              {t("actions.delete")}
            </Button>
          ) : null}
          {!isStarterState ? (
            <Button
              size="sm"
              onClick={onSave}
              disabled={saveDisabled}
              className="h-8 rounded-lg text-[12px]"
            >
              <Save className="mr-1.5 size-3.5" />
              {isSaving
                ? t("actions.saving")
                : selectedAgent
                  ? t("actions.save")
                  : t("actions.create")}
            </Button>
          ) : null}
        </div>
      </div>
    </GlassCardHeader>
  )
}
