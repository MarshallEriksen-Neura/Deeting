"use client"

import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { ArrowLeft } from "lucide-react"
import { GlassButton } from "@/components/ui/glass-button"

export function BackButton() {
  const router = useRouter()
  const t = useTranslations("common")

  return (
    <GlassButton 
      variant="ghost" 
      size="sm" 
      onClick={() => router.back()}
      className="text-[var(--muted)] hover:text-[var(--foreground)] px-0 hover:bg-transparent"
    >
      <ArrowLeft className="size-4 mr-2" />
      {t("back")}
    </GlassButton>
  )
}
