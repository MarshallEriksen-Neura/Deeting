"use client"

import dynamic from "next/dynamic"
import { Skeleton } from "@/ui/shadcn/skeleton"
import { useI18n } from "@/hooks/use-i18n"
import { useUserProfile } from "@/hooks/use-user"
import type { SettingsSection } from "../section"
import { SettingsHeader } from "./settings-header"
import { SettingsAlerts } from "./settings-alerts"

const SettingsForm = dynamic(
  () => import("./settings-form").then((mod) => mod.SettingsForm),
  {
    loading: () => <SettingsFormSkeleton />,
  }
)

interface SettingsClientProps {
  initialSection?: SettingsSection
}

export function SettingsClient({
  initialSection = "models",
}: SettingsClientProps) {
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
    <div className="relative flex flex-col gap-6">
      <div className="pointer-events-none absolute inset-x-10 top-12 -z-10 h-48 rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--accent-soft)_82%,white_18%),transparent_68%)] blur-3xl" />
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
        initialSection={initialSection}
      />
    </div>
  )
}

function SettingsFormSkeleton() {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:gap-6">
      <div className="hidden md:block md:w-[292px] md:shrink-0">
        <div className="rounded-[26px] border border-[var(--hairline)] bg-[var(--panel-bg)] p-4 shadow-[var(--elev-floating)]">
          <div className="space-y-3">
            <Skeleton className="h-4 w-28 rounded-full" />
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 rounded-[18px] border border-[var(--hairline)] p-3">
                <Skeleton className="h-10 w-10 rounded-[14px]" />
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-3.5 w-20" />
                  <Skeleton className="h-2.5 w-32" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="min-w-0 flex-1 space-y-5">
        {[1, 2].map((i) => (
          <div key={i} className="rounded-[24px] border border-[var(--hairline)] bg-[var(--panel-bg)] p-6 shadow-[var(--elev-floating)]">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-[14px]" />
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-56" />
                </div>
              </div>
              <Skeleton className="h-12 w-full rounded-[16px]" />
              <Skeleton className="h-28 w-full rounded-[18px]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
