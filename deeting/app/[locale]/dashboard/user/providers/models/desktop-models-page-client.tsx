"use client"

import { useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { Layers, AlertCircle } from "lucide-react"

import { Container } from "@/components/ui/container"
import { PageHeader } from "@/components/ui/page-header/page-header"
import { ModelsManager } from "@/components/models/models-manager"
import { BackButton } from "@/components/ui/back-button"
import { GlassCard } from "@/components/ui/glass-card"

export function DesktopModelsPageClient() {
  const t = useTranslations("models")
  const searchParams = useSearchParams()
  const instanceId = searchParams.get("instanceId")?.trim() ?? ""

  return (
    <Container as="main" className="py-6 md:py-8" gutter="md">
      <div className="mb-4">
        <BackButton />
      </div>
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        icon={Layers}
      />

      {instanceId ? (
        <ModelsManager instanceId={instanceId} />
      ) : (
        <GlassCard className="p-8 flex flex-col items-center justify-center text-center gap-4">
          <AlertCircle className="size-10 text-amber-500" />
          <div>
            <h3 className="text-lg font-semibold text-[var(--foreground)]">{t("error.title")}</h3>
            <p className="text-sm text-[var(--muted)] max-w-md mt-1">
              Missing provider instance id.
            </p>
          </div>
        </GlassCard>
      )}
    </Container>
  )
}
