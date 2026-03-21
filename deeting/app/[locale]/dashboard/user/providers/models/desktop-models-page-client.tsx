"use client"

import { Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { Layers, AlertCircle } from "lucide-react"

import { Container } from "@/components/ui/container"
import { PageHeader } from "@/components/ui/page-header/page-header"
import { ModelsManager } from "@/components/models/models-manager"
import { BackButton } from "@/components/ui/back-button"
import { GlassCard } from "@/components/ui/glass-card"
import { Skeleton } from "@/components/ui/skeleton"

export function DesktopModelsPageClient() {
  const t = useTranslations("models")

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

      <Suspense fallback={<DesktopModelsFallback />}>
        <DesktopModelsPageContent />
      </Suspense>
    </Container>
  )
}

function DesktopModelsPageContent() {
  const t = useTranslations("models")
  const searchParams = useSearchParams()
  const instanceId = searchParams.get("instanceId")?.trim() ?? ""

  if (instanceId) {
    return <ModelsManager instanceId={instanceId} />
  }

  return (
    <GlassCard className="flex flex-col items-center justify-center gap-4 p-8 text-center">
      <AlertCircle className="size-10 text-amber-500" />
      <div>
        <h3 className="text-lg font-semibold text-[var(--foreground)]">{t("error.title")}</h3>
        <p className="mt-1 max-w-md text-sm text-[var(--muted)]">
          Missing provider instance id.
        </p>
      </div>
    </GlassCard>
  )
}

function DesktopModelsFallback() {
  return (
    <GlassCard className="space-y-4 p-6">
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-64" />
        </div>
      </div>
      <Skeleton className="h-32 w-full rounded-2xl" />
    </GlassCard>
  )
}
