import Link from "next/link"
import {
  ArrowRight,
  Package2,
  PackagePlus,
  ShieldCheck,
  Users,
} from "lucide-react"
import { getTranslations, setRequestLocale } from "next-intl/server"

import { AdminPageShell, AdminStatCards } from "@/components/admin"
import { Button } from "@/ui/shadcn/button"
import { GlassCard } from "@/ui/common/glass-card"

const ADMIN_MODULES = [
  {
    href: "/admin/users",
    titleKey: "users.title",
    descriptionKey: "users.description",
    metaKey: "dashboard.moduleMeta.users",
    icon: Users,
  },
  {
    href: "/admin/provider-presets",
    titleKey: "providerPresets.title",
    descriptionKey: "providerPresets.description",
    metaKey: "dashboard.moduleMeta.providerPresets",
    icon: Package2,
  },
] as const

export default async function AdminLandingPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const tAdmin = await getTranslations({ locale, namespace: "admin" })

  return (
    <AdminPageShell
      title={tAdmin("dashboard.title")}
      description={tAdmin("dashboard.description")}
      actions={
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/users">{tAdmin("dashboard.manageUsers")}</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/admin/provider-presets/new">
              <PackagePlus className="mr-2 size-4" />
              {tAdmin("dashboard.createPreset")}
            </Link>
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <GlassCard padding="default" hover="none" className="overflow-hidden">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_420px]">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-[var(--primary)]/15 bg-[var(--primary)]/8 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--primary)]">
                <ShieldCheck className="size-3.5" />
                {tAdmin("dashboard.commandCenter")}
              </div>
              <div className="space-y-2">
                <h2 className="text-3xl font-semibold tracking-tight text-[var(--foreground)]">
                  {tAdmin("dashboard.controlPlaneTitle")}
                </h2>
                <p className="max-w-3xl text-sm leading-7 text-[var(--muted)]">
                  {tAdmin("dashboard.controlPlaneDescription")}
                </p>
              </div>
            </div>

            <div className="grid gap-3">
              <GlassCard padding="default" hover="lift">
                <div className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--muted)]">
                    {tAdmin("dashboard.quickActions")}
                  </div>
                  <div className="grid gap-2">
                    <Button asChild variant="outline" className="justify-between">
                      <Link href="/admin/users">
                        {tAdmin("dashboard.manageUsers")}
                        <ArrowRight className="size-4" />
                      </Link>
                    </Button>
                    <Button asChild variant="outline" className="justify-between">
                      <Link href="/admin/provider-presets">
                        {tAdmin("providerPresets.title")}
                        <ArrowRight className="size-4" />
                      </Link>
                    </Button>
                    <Button asChild className="justify-between">
                      <Link href="/admin/provider-presets/new">
                        {tAdmin("dashboard.createPreset")}
                        <ArrowRight className="size-4" />
                      </Link>
                    </Button>
                  </div>
                </div>
              </GlassCard>
            </div>
          </div>
        </GlassCard>

        <AdminStatCards
          stats={[
            {
              label: tAdmin("dashboard.surfaceStats.coreModules"),
              value: ADMIN_MODULES.length,
              icon: ShieldCheck,
              color: "primary",
              subtitle: tAdmin("dashboard.surfaceStats.coreModulesHint"),
            },
            {
              label: tAdmin("dashboard.surfaceStats.presetWorkflow"),
              value: tAdmin("dashboard.surfaceStats.ready"),
              icon: Package2,
              color: "emerald",
              subtitle: tAdmin("dashboard.surfaceStats.presetWorkflowHint"),
            },
            {
              label: tAdmin("dashboard.surfaceStats.userControls"),
              value: tAdmin("dashboard.surfaceStats.available"),
              icon: Users,
              color: "teal",
              subtitle: tAdmin("dashboard.surfaceStats.userControlsHint"),
            },
          ]}
          columns={3}
        />

        <div className="grid gap-4 xl:grid-cols-2">
          {ADMIN_MODULES.map(({ href, titleKey, descriptionKey, metaKey, icon: Icon }) => (
            <Link key={href} href={href} className="block">
              <GlassCard padding="default" hover="lift" className="h-full cursor-pointer">
                <div className="flex h-full flex-col gap-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex size-12 items-center justify-center rounded-2xl bg-[var(--primary)]/10">
                      <Icon className="size-6 text-[var(--primary)]" />
                    </div>
                    <ArrowRight className="size-5 text-[var(--muted)]" />
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--muted)]">
                      {tAdmin(metaKey)}
                    </div>
                    <h2 className="text-xl font-semibold text-[var(--foreground)]">
                      {tAdmin(titleKey)}
                    </h2>
                    <p className="text-sm leading-6 text-[var(--muted)]">
                      {tAdmin(descriptionKey)}
                    </p>
                  </div>
                </div>
              </GlassCard>
            </Link>
          ))}
        </div>
      </div>
    </AdminPageShell>
  )
}
