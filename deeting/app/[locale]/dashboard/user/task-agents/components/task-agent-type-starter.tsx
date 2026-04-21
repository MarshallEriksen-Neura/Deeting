"use client"

import * as React from "react"
import { ArrowRight, Bot, ImageIcon, Volume2 } from "lucide-react"
import { cn } from "@/lib/utils"

type TaskAgentKind = "chat" | "image_generation" | "text_to_speech"

type TaskAgentTypeStarterProps = {
  t: (key: string) => string
  onSelect: (kind: TaskAgentKind) => void
}

type OptionSpec = {
  kind: TaskAgentKind
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
}

function OptionRow({
  option,
  onSelect,
}: {
  option: OptionSpec
  onSelect: (kind: TaskAgentKind) => void
}) {
  const { icon: Icon, title, description, kind } = option
  return (
    <button
      type="button"
      onClick={() => onSelect(kind)}
      className={cn(
        "group flex w-full items-center gap-4 rounded-2xl border border-[var(--hairline)] bg-[var(--panel-bg-inset)]/30 px-5 py-4 text-left transition-all",
        "hover:border-[var(--accent-border)] hover:bg-[var(--accent-soft)]",
      )}
    >
      <div
        className={cn(
          "flex size-12 shrink-0 items-center justify-center rounded-xl border border-[var(--hairline)] bg-[var(--panel-bg)] text-[var(--ink-3)]",
          "transition-colors group-hover:border-[var(--accent-border)] group-hover:bg-[var(--accent-soft)] group-hover:text-[var(--accent-strong)]",
        )}
      >
        <Icon className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="ws-control text-sm font-bold text-[var(--ink-1)]">
          {title}
        </p>
        <p className="ws-body mt-0.5 truncate text-xs text-[var(--ink-3)] opacity-70">
          {description}
        </p>
      </div>
      <ArrowRight className="size-4 shrink-0 text-[var(--ink-4)] opacity-40 transition-all group-hover:translate-x-1 group-hover:opacity-100 group-hover:text-[var(--accent-strong)]" />
    </button>
  )
}

export function TaskAgentTypeStarter({ t, onSelect }: TaskAgentTypeStarterProps) {
  const options: OptionSpec[] = [
    {
      kind: "chat",
      icon: Bot,
      title: t("starter.chat.title"),
      description: t("starter.chat.description"),
    },
    {
      kind: "image_generation",
      icon: ImageIcon,
      title: t("starter.image.title"),
      description: t("starter.image.description"),
    },
    {
      kind: "text_to_speech",
      icon: Volume2,
      title: t("starter.voice.title"),
      description: t("starter.voice.description"),
    },
  ]

  return (
    <div className="space-y-6">
      <header className="space-y-1.5">
        <h2 className="ws-pane-title text-xl font-bold tracking-tight text-[var(--ink-1)]">
          {t("starter.title")}
        </h2>
        <p className="ws-body max-w-xl text-xs text-[var(--ink-3)] opacity-70 leading-relaxed">
          {t("starter.description")}
        </p>
      </header>

      <div className="space-y-3">
        {options.map((option) => (
          <OptionRow key={option.kind} option={option} onSelect={onSelect} />
        ))}
      </div>
    </div>
  )
}
