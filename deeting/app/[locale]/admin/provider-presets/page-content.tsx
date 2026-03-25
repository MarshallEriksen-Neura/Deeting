"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import useSWR from "swr"
import { Package } from "lucide-react"
import { AdminStatusBadge } from "@/components/admin"
import { Button } from "@/components/ui/button"
import { GlassCard } from "@/components/ui/glass-card"
import { Input } from "@/components/ui/input"
import { fetchAdminProviderPresets } from "@/lib/api/admin-dashboard"

export function PageContent() {
  const t = useTranslations("admin.providerPresetsPage")
  const common = useTranslations("admin.common")
  const [searchQuery, setSearchQuery] = useState("")
  const { data, error, isLoading } = useSWR(
    "/api/v1/admin/provider-presets",
    fetchAdminProviderPresets
  )

  const rows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return data ?? []
    return (data ?? []).filter((preset) =>
      [preset.name, preset.slug, preset.provider, preset.base_url, preset.category].some((value) =>
        String(value ?? "").toLowerCase().includes(query)
      )
    )
  }, [data, searchQuery])

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <p className="text-sm text-[var(--muted)]">{t("managementHint")}</p>
        <Input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder={common("searchPlaceholder")}
          className="w-full md:max-w-sm"
        />
      </div>

      {isLoading && <p className="text-sm text-[var(--muted)]">{t("empty.loading")}</p>}
      {error && <p className="text-sm text-rose-300">{t("empty.failed")}</p>}
      {!isLoading && !error && rows.length === 0 && (
        <p className="text-sm text-[var(--muted)]">{t("empty.noData")}</p>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {rows.map((preset) => {
          const status = preset.is_active ? "active" : "inactive"
          return (
            <GlassCard
              key={`${preset.id ?? preset.slug ?? preset.name}`}
              padding="default"
              hover="lift"
              className="cursor-pointer"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-[var(--primary)]/10">
                    <Package className="size-5 text-[var(--primary)]" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-[var(--foreground)]">
                      {preset.name || t("card.unnamedPreset")}
                    </h4>
                    <span className="font-mono text-xs text-[var(--muted)]">
                      {preset.slug || "—"}
                    </span>
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
              {preset.slug && (
                <div className="mt-4 flex items-center justify-end">
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/admin/provider-presets/${preset.slug}`}>
                      {t("actions.edit")}
                    </Link>
                  </Button>
                </div>
              )}
            </GlassCard>
          )
        })}
      </div>
    </>
  )
}
