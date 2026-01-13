"use client"

import { Plus } from "lucide-react"
import { useTranslations } from "next-intl"
import { GlassButton } from "@/components/ui/glass-button"
import { useApiKeyDrawerStore } from "@/store/api-key-drawer-store"

export function MintKeyButton() {
  const t = useTranslations("apiKeys")
  const { openDrawer } = useApiKeyDrawerStore()

  return (
    <GlassButton onClick={openDrawer}>
      <Plus className="size-4" />
      {t("mintNew")}
    </GlassButton>
  )
}
