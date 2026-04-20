"use client"

import { Plus } from "lucide-react"
import { useTranslations } from "next-intl"
import { GlassButton } from "@/ui/common/glass-button"
import { useApiKeyDrawerStore } from "@/store/api-key-drawer-store"

export function MintKeyButton() {
  const t = useTranslations("api-keys")
  const { openDrawer } = useApiKeyDrawerStore()

  return (
    <GlassButton onClick={openDrawer}>
      <Plus className="size-4" />
      {t("mintNew")}
    </GlassButton>
  )
}
