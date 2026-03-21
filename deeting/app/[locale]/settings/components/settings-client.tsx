"use client"

import dynamic from "next/dynamic"
import { Container } from "@/components/ui/container"
import { Skeleton } from "@/components/ui/skeleton"
import { useI18n } from "@/hooks/use-i18n"
import { useUserProfile } from "@/hooks/use-user"
import { SettingsHeader } from "./settings-header"
import { SettingsAlerts } from "./settings-alerts"

const SettingsForm = dynamic(
  () => import("./settings-form").then((mod) => mod.SettingsForm),
  {
    loading: () => <SettingsFormSkeleton />,
  }
)

export function SettingsClient() {
  const t = useI18n("settings")
  const isTauri = process.env.NEXT_PUBLIC_IS_TAURI === "true"
  const { profile, isLoading: isLoadingProfile, isAuthenticated } = useUserProfile()

  const isAdmin = Boolean(profile?.is_superuser)
  const roleLabel = !isAuthenticated
    ? t("role.guest")
    : isAdmin
    ? t("role.admin")
    : t("role.user")

  return (
    <Container
      as="main"
      gutter="md"
      size="full"
      className="py-6 md:py-8 !mx-0 !max-w-none"
    >
      <SettingsHeader
        isTauri={isTauri}
        isAdmin={isAdmin}
        roleLabel={roleLabel}
        isLoading={isLoadingProfile}
      />

      <SettingsAlerts isAuthenticated={isAuthenticated} />

      <SettingsForm
        isAuthenticated={isAuthenticated}
        isTauriRuntime={isTauri}
      />
    </Container>
  )
}

function SettingsFormSkeleton() {
  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-border/60 bg-card/80 p-6">
        <div className="space-y-4">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      </div>
      <div className="rounded-3xl border border-border/60 bg-card/80 p-6">
        <div className="space-y-4">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    </div>
  )
}
