"use client"

import { useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { GlassCard } from "@/ui/common/glass-card"
import { PresetEditorConsole } from "../components/preset-editor-console"

export function PageContent() {
  const searchParams = useSearchParams()
  const t = useTranslations("admin.providerPresetsEditor")
  const slug = searchParams.get("slug")?.trim() ?? ""

  if (!slug) {
    return (
      <GlassCard padding="default" hover="none">
        <p className="text-sm text-rose-300">{t("feedback.loadFailed")}</p>
      </GlassCard>
    )
  }

  return <PresetEditorConsole mode="edit" slug={slug} />
}
