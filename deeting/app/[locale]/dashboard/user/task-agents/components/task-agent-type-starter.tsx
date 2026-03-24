"use client"

import { ArrowRight, Bot, ImageIcon, Sparkles, Volume2, Wrench } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  GlassCard,
  GlassCardContent,
  GlassCardDescription,
  GlassCardHeader,
  GlassCardTitle,
} from "@/components/ui/glass-card"

type TaskAgentTypeStarterProps = {
  t: (key: string) => string
  onSelect: (kind: "chat" | "image_generation" | "text_to_speech") => void
}

export function TaskAgentTypeStarter({
  t,
  onSelect,
}: TaskAgentTypeStarterProps) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold text-[var(--foreground)]">
          {t("starter.title")}
        </h2>
        <p className="max-w-2xl text-sm text-[var(--muted)]">
          {t("starter.description")}
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <GlassCard className="overflow-hidden border-cyan-500/20 bg-cyan-500/[0.06]">
          <GlassCardHeader className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-3 text-cyan-200">
                <Bot className="size-5" />
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge className="border-cyan-400/20 bg-cyan-400/10 text-cyan-100">
                  {t("starter.chat.tags.chat")}
                </Badge>
                <Badge className="border-cyan-400/20 bg-cyan-400/10 text-cyan-100">
                  {t("starter.chat.tags.skills")}
                </Badge>
                <Badge className="border-cyan-400/20 bg-cyan-400/10 text-cyan-100">
                  {t("starter.chat.tags.tools")}
                </Badge>
              </div>
            </div>
            <div className="space-y-2">
              <GlassCardTitle>{t("starter.chat.title")}</GlassCardTitle>
              <GlassCardDescription>
                {t("starter.chat.description")}
              </GlassCardDescription>
            </div>
          </GlassCardHeader>
          <GlassCardContent className="space-y-4">
            <div className="grid gap-3 text-sm text-[var(--muted)]">
              <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/10 px-4 py-3">
                <Sparkles className="size-4 text-cyan-200" />
                <span>{t("starter.chat.features.chat")}</span>
              </div>
              <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/10 px-4 py-3">
                <Wrench className="size-4 text-cyan-200" />
                <span>{t("starter.chat.features.skills")}</span>
              </div>
            </div>

            <Button className="w-full" onClick={() => onSelect("chat")}>
              {t("starter.chat.cta")}
              <ArrowRight className="ml-2 size-4" />
            </Button>
          </GlassCardContent>
        </GlassCard>

        <GlassCard className="overflow-hidden border-fuchsia-500/20 bg-fuchsia-500/[0.06]">
          <GlassCardHeader className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="rounded-2xl border border-fuchsia-400/20 bg-fuchsia-400/10 p-3 text-fuchsia-200">
                <ImageIcon className="size-5" />
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge className="border-fuchsia-400/20 bg-fuchsia-400/10 text-fuchsia-100">
                  {t("starter.image.tags.style")}
                </Badge>
                <Badge className="border-fuchsia-400/20 bg-fuchsia-400/10 text-fuchsia-100">
                  {t("starter.image.tags.params")}
                </Badge>
                <Badge className="border-fuchsia-400/20 bg-fuchsia-400/10 text-fuchsia-100">
                  {t("starter.image.tags.preview")}
                </Badge>
              </div>
            </div>
            <div className="space-y-2">
              <GlassCardTitle>{t("starter.image.title")}</GlassCardTitle>
              <GlassCardDescription>
                {t("starter.image.description")}
              </GlassCardDescription>
            </div>
          </GlassCardHeader>
          <GlassCardContent className="space-y-4">
            <div className="grid gap-3 text-sm text-[var(--muted)]">
              <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/10 px-4 py-3">
                <Sparkles className="size-4 text-fuchsia-200" />
                <span>{t("starter.image.features.invoke")}</span>
              </div>
              <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/10 px-4 py-3">
                <ImageIcon className="size-4 text-fuchsia-200" />
                <span>{t("starter.image.features.preview")}</span>
              </div>
            </div>

            <Button className="w-full" onClick={() => onSelect("image_generation")}>
              {t("starter.image.cta")}
              <ArrowRight className="ml-2 size-4" />
            </Button>
          </GlassCardContent>
        </GlassCard>

        <GlassCard className="overflow-hidden border-emerald-500/20 bg-emerald-500/[0.06]">
          <GlassCardHeader className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-emerald-200">
                <Volume2 className="size-5" />
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge className="border-emerald-400/20 bg-emerald-400/10 text-emerald-100">
                  {t("starter.voice.tags.voice")}
                </Badge>
                <Badge className="border-emerald-400/20 bg-emerald-400/10 text-emerald-100">
                  {t("starter.voice.tags.output")}
                </Badge>
                <Badge className="border-emerald-400/20 bg-emerald-400/10 text-emerald-100">
                  {t("starter.voice.tags.preview")}
                </Badge>
              </div>
            </div>
            <div className="space-y-2">
              <GlassCardTitle>{t("starter.voice.title")}</GlassCardTitle>
              <GlassCardDescription>
                {t("starter.voice.description")}
              </GlassCardDescription>
            </div>
          </GlassCardHeader>
          <GlassCardContent className="space-y-4">
            <div className="grid gap-3 text-sm text-[var(--muted)]">
              <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/10 px-4 py-3">
                <Sparkles className="size-4 text-emerald-200" />
                <span>{t("starter.voice.features.invoke")}</span>
              </div>
              <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/10 px-4 py-3">
                <Volume2 className="size-4 text-emerald-200" />
                <span>{t("starter.voice.features.preview")}</span>
              </div>
            </div>

            <Button className="w-full" onClick={() => onSelect("text_to_speech")}>
              {t("starter.voice.cta")}
              <ArrowRight className="ml-2 size-4" />
            </Button>
          </GlassCardContent>
        </GlassCard>
      </div>
    </div>
  )
}
