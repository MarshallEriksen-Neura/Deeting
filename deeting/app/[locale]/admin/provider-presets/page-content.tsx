"use client"

import { useTranslations } from "next-intl"
import useSWR from "swr"
import { Package } from "lucide-react"
import { AdminPageShell, AdminStatusBadge } from "@/components/admin"
import { GlassCard } from "@/components/ui/glass-card"
import { fetchAdminProviderPresets } from "@/lib/api/admin-dashboard"

export function PageContent() {
  const tAdmin = useTranslations("admin")
  const t = useTranslations("admin.providerPresetsPage")
  const { data, error, isLoading } = useSWR(
    "/api/v1/admin/provider-presets",
    fetchAdminProviderPresets
  )

  const rows = data ?? []

  return (
    <AdminPageShell
      title={tAdmin("providerPresets.title")}
      description={tAdmin("providerPresets.description")}
      icon={Package}
    >
      {isLoading && <p className="text-sm text-[var(--muted)]">{t("empty.loading")}</p>}
      {error && <p className="text-sm text-rose-300">{t("empty.failed")}</p>}
      {!isLoading && !error && rows.length === 0 && (
        <p className="text-sm text-[var(--muted)]">{t("empty.noData")}</p>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {rows.map((preset) => {
          const status = preset.is_active ? "active" : "inactive"
          return (
            <GlassCard key={`${preset.id ?? preset.slug ?? preset.name}`} padding="default" hover="lift" className="cursor-pointer">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-[var(--primary)]/10">
                    <Package className="size-5 text-[var(--primary)]" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-[var(--foreground)]">{preset.name || t("card.unnamedPreset")}</h4>
                    <span className="font-mono text-xs text-[var(--muted)]">{preset.slug || "—"}</span>
                  </div>
                </div>
                <AdminStatusBadge
                  text={status === "active" ? t("status.active") : t("status.inactive")}
                  tone={preset.is_active ? "success" : "error"}
                />
              </div>
              <p className="mt-3 text-sm text-[var(--muted)]">
                {preset.provider || t("card.unknownProvider")}
                {preset.category ? ` · ${preset.category}` : ""}
              </p>
              {preset.base_url && (
                <p className="mt-2 inline-block max-w-full truncate font-mono text-xs text-[var(--muted)]">
                  {preset.base_url}
                </p>
              )}
            </GlassCard>
          )
        })}
      </div>
    </AdminPageShell>
  )
}
