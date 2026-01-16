"use client"

import { Plus, Terminal } from "lucide-react"
import { GlassButton } from "@/components/ui/glass-button"
import dynamic from "next/dynamic"
import { useTranslations } from "next-intl"

const AddServerSheet = dynamic(() => import("./add-server-sheet").then(mod => mod.AddServerSheet), { ssr: false })

interface RegistryHeaderProps {
  onCreateManual: (payload: { config: Record<string, unknown> }) => void
}

export function RegistryHeader({ onCreateManual }: RegistryHeaderProps) {
  const t = useTranslations("mcp")

  return (
    <div className="flex items-end justify-between">
      <div className="space-y-1">
        <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight text-[var(--foreground)]">
          <div className="flex size-10 items-center justify-center rounded-xl bg-[var(--primary)]/10 text-[var(--primary)] shadow-sm">
            <Terminal size={22} />
          </div>
          {t("header.title")}
        </h1>
        <p className="max-w-2xl text-sm text-[var(--muted)]">
          {t("header.description")}
        </p>
      </div>

      <AddServerSheet onCreate={onCreateManual}>
        <GlassButton variant="default" size="lg" className="px-6">
          <Plus size={18} className="mr-2" />
          {t("header.addManual")}
        </GlassButton>
      </AddServerSheet>
    </div>
  )
}
