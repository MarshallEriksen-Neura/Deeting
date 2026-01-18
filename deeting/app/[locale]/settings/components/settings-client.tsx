"use client"

import { Container } from "@/components/ui/container"
import { useI18n } from "@/hooks/use-i18n"
import { useUserProfile } from "@/hooks/use-user"
import { SettingsHeader } from "./settings-header"
import { SettingsAlerts } from "./settings-alerts"
import { SettingsForm } from "./settings-form"

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
        isAdmin={isAdmin}
      />
    </Container>
  )
}
