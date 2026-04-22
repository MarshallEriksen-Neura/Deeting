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
  t,
}: {
  option: OptionSpec
  onSelect: (kind: TaskAgentKind) => void
  t: (key: string) => string
}) {
  const { title, description, kind } = option
  return (
    <button
      type="button"
      onClick={() => onSelect(kind)}
      className="group block w-full text-left py-12 border-b border-[var(--hairline-strong)] transition-all hover:pl-4"
    >
      <div className="flex items-baseline gap-6">
        <span className="font-mono text-[10px] font-bold tracking-[0.4em] text-[var(--accent-strong)] opacity-40 group-hover:opacity-100 transition-opacity">
          {t("starter.typePrefix")}
          {kind.toUpperCase()}
        </span>
        <h3 className="text-5xl font-bold tracking-tighter text-[var(--ink-2)] group-hover:text-[var(--ink)] transition-colors">
          {title.toUpperCase()}
        </h3>
      </div>
      <p className="mt-4 text-[13px] text-[var(--ink-4)] group-hover:text-[var(--ink-3)] transition-colors max-w-lg leading-relaxed">
        {description}
      </p>
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
    <div className="space-y-24">
      <header className="space-y-6">
        <h2 className="text-6xl font-bold tracking-tight text-[var(--ink)] uppercase">
          {t("starter.title")}
        </h2>
        <div className="flex items-center gap-4">
           <div className="h-px w-12 bg-[var(--accent-strong)]" />
           <p className="font-mono text-[10px] font-bold tracking-[0.3em] text-[var(--ink-4)] uppercase">
             {t("starter.protocol")}
           </p>
        </div>
      </header>

      <div className="border-t border-[var(--hairline-strong)]">
        {options.map((option) => (
          <OptionRow key={option.kind} option={option} onSelect={onSelect} t={t} />
        ))}
      </div>
    </div>
  )
}
