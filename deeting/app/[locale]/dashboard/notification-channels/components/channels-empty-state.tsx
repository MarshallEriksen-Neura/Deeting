"use client"

import { Bell } from "lucide-react"
import { useTranslations } from "next-intl"
import { GlassButton } from "@/components/ui/glass-button"

export function ChannelsEmptyState({ onAdd }: { onAdd: () => void }) {
  const t = useTranslations("dashboard.notificationChannelsPage")

  return (
    <div className="flex flex-col items-center py-16">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--primary)]/10">
        <Bell className="h-7 w-7 text-[var(--primary)] opacity-60" />
      </div>
      <p className="text-sm text-[var(--muted)]">{t("empty.description")}</p>
      <GlassButton type="button" size="sm" onClick={onAdd} className="mt-4">
        {t("empty.addFirst")}
      </GlassButton>
    </div>
  )
}

