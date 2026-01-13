"use client"

import { Plus } from "lucide-react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { GlassButton } from "@/components/ui/glass-button"

export function ConnectProviderButton() {
  const router = useRouter()
  const t = useTranslations("providers.manager")

  return (
    <GlassButton 
      variant="outline" 
      onClick={() => router.push("/dashboard/user/providers/market")}
    >
      <Plus className="mr-2 size-4" />
      {t("connect")}
    </GlassButton>
  )
}
