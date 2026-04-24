"use client"

import { Plus, Terminal } from "lucide-react"
import { GlassButton } from "@/components/ui/common/glass-button"
import dynamic from "next/dynamic"
import { useTranslations } from "next-intl"

const AddServerSheet = dynamic(() => import("./add-server-sheet").then(mod => mod.AddServerSheet), { ssr: false })

interface RegistryHeaderProps {
  onCreateManual: (payload: { config: Record<string, unknown> }) => Promise<boolean> | boolean
}

export function RegistryHeader({ onCreateManual }: RegistryHeaderProps) {
  const t = useTranslations("mcp")

  return (
    <div className="flex items-end justify-between gap-4">
      <div className="space-y-2">
        <h1 className="flex items-center gap-3 text-[28px] font-semibold tracking-[-0.4px] text-[var(--ink)]">
          <span className="flex size-10 items-center justify-center rounded-[var(--r-10)] bg-[var(--accent-soft)] text-[var(--accent-strong)] ring-1 ring-[var(--accent-border)]">
            <Terminal size={22} strokeWidth={1.5} />
          </span>
          {t("header.title")}
        </h1>
        <p className="max-w-2xl text-[13px] leading-relaxed text-[var(--ink-3)]">
          {t("header.description")}
        </p>
      </div>

      <AddServerSheet onCreate={onCreateManual}>
        <GlassButton variant="default" size="lg" className="px-5">
          <Plus size={16} className="mr-1.5" />
          {t("header.addManual")}
        </GlassButton>
      </AddServerSheet>
    </div>
  )
}
