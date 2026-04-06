"use client"

import dynamic from "next/dynamic"
import { useSearchParams } from "next/navigation"
import { Skeleton } from "@/components/ui/skeleton"
import { useI18n } from "@/hooks/use-i18n"
import { useUserProfile } from "@/hooks/use-user"
import { SettingsHeader } from "./settings-header"
import { SettingsAlerts } from "./settings-alerts"
import { normalizeSettingsSection } from "./settings-nav"

const SettingsForm = dynamic(
  () => import("./settings-form").then((mod) => mod.SettingsForm),
  {
    loading: () => <SettingsFormSkeleton />,
  }
)

export function SettingsClient() {
  const t = useI18n("settings")
  const isTauri = process.env.NEXT_PUBLIC_IS_TAURI === "true"
  const searchParams = useSearchParams()
  const { profile, isLoading: isLoadingProfile, isAuthenticated } = useUserProfile()
  const initialSection = normalizeSettingsSection(searchParams.get("section"))

  const isAdmin = Boolean(profile?.is_superuser)
  const roleLabel = !isAuthenticated
    ? t("role.guest")
    : isAdmin
    ? t("role.admin")
    : t("role.user")

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-10">
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
    </main>
  )
}

function SettingsFormSkeleton() {
  return (
    <div className="flex flex-col gap-0 md:flex-row md:gap-8">
      {/* Nav skeleton */}
      <div className="hidden md:flex md:w-56 md:shrink-0 md:flex-col md:gap-1">
        {[1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3 rounded-xl px-3 py-3">
            <Skeleton className="h-8 w-8 rounded-lg" />
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-3.5 w-16" />
              <Skeleton className="h-2.5 w-24" />
            </div>
          </div>
        ))}
      </div>
      {/* Content skeleton */}
      <div className="min-w-0 flex-1 space-y-5">
        <div className="rounded-2xl border border-border/40 bg-card/50 p-6">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Skeleton className="h-9 w-9 rounded-xl" />
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-56" />
              </div>
            </div>
            <Skeleton className="h-12 w-full rounded-xl" />
          </div>
        </div>
        <div className="rounded-2xl border border-border/40 bg-card/50 p-6">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Skeleton className="h-9 w-9 rounded-xl" />
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-3 w-48" />
              </div>
            </div>
            <Skeleton className="h-12 w-full rounded-xl" />
            <Skeleton className="h-28 w-full rounded-xl" />
          </div>
        </div>
      </div>
    </div>
  )
}
