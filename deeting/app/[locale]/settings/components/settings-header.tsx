"use client"

import { Cloud, Monitor, ShieldCheck, Sparkles, User } from "lucide-react"
import { useI18n } from "@/hooks/use-i18n"

interface SettingsHeaderProps {
  isTauri: boolean
  isAdmin: boolean
  roleLabel: string
  isLoading: boolean
}

export function SettingsHeader({ isTauri, isAdmin, roleLabel, isLoading }: SettingsHeaderProps) {
  const t = useI18n("settings")

  return (
    <section className="relative overflow-hidden rounded-[28px] border border-[var(--hairline-strong)] bg-[linear-gradient(140deg,color-mix(in_srgb,var(--panel-bg)_86%,white_14%)_0%,color-mix(in_srgb,var(--panel-bg-inset)_78%,white_22%)_44%,color-mix(in_srgb,var(--window-bg)_72%,var(--accent-soft)_28%)_100%)] px-6 py-6 shadow-[var(--elev-floating)] md:px-7 md:py-7">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,color-mix(in_srgb,var(--accent-soft)_94%,white_6%),transparent_34%),radial-gradient(circle_at_bottom_left,color-mix(in_srgb,var(--info-soft)_78%,white_22%),transparent_30%)] opacity-95" />
      <div className="pointer-events-none absolute inset-y-5 right-5 hidden w-40 rounded-full border border-[color-mix(in_srgb,var(--hairline)_60%,white_40%)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--panel-bg)_30%,white_70%),transparent)] opacity-70 blur-2xl lg:block" />

      <div className="relative flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
        <div className="max-w-3xl space-y-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-[var(--accent-border)] bg-[color-mix(in_srgb,var(--accent-soft)_82%,white_18%)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--accent-ink)] shadow-[0_10px_24px_-18px_color-mix(in_srgb,var(--accent-strong)_38%,transparent)]">
            <Sparkles className="size-3.5" />
            <span>Settings Atelier</span>
          </div>

          <div className="space-y-3">
            <h1 className="max-w-3xl text-[28px] font-semibold leading-[1.05] tracking-[-0.05em] text-[var(--ink)] md:text-[38px]">
              {t("title")}
            </h1>
            <p className="max-w-2xl text-[15px] leading-7 text-[var(--ink-2)] md:text-[16px]">
              {t("subtitle")}
            </p>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-3 xl:min-w-[420px]">
          <StatusChip
            icon={isTauri ? Monitor : Cloud}
            label="Runtime"
            value={isTauri ? t("env.desktop") : t("env.web")}
          />
          <StatusChip
            icon={isAdmin ? ShieldCheck : User}
            label="Role"
            value={isLoading ? t("role.loading") : roleLabel}
            accent={isAdmin}
          />
          <StatusChip
            icon={Sparkles}
            label="Boundary"
            value="Desktop-first"
          />
        </div>
      </div>
    </section>
  )
}

function StatusChip({
  icon: Icon,
  label,
  value,
  accent = false,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  accent?: boolean
}) {
  return (
    <div className="rounded-[20px] border border-[var(--hairline-strong)] bg-[color-mix(in_srgb,var(--panel-bg)_78%,white_22%)] px-3.5 py-3 shadow-[0_14px_30px_-24px_rgba(15,23,42,0.28)] backdrop-blur-sm">
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--ink-3)]">
        <Icon className={accent ? "size-3.5 text-[var(--accent-strong)]" : "size-3.5"} />
        <span>{label}</span>
      </div>
      <div className="mt-2 text-sm font-semibold tracking-[-0.02em] text-[var(--ink)]">
        {value}
      </div>
    </div>
  )
}
