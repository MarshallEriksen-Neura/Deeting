import Link from "next/link"
import { ArrowRight, Package, Users } from "lucide-react"
import { getTranslations, setRequestLocale } from "next-intl/server"

import { AdminPageShell } from "@/components/admin"
import { GlassCard } from "@/components/ui/glass-card"

const ADMIN_ENTRY_CARDS = [
  {
    href: "/admin/users",
    titleKey: "users.title",
    descriptionKey: "users.description",
    icon: Users,
  },
  {
    href: "/admin/provider-presets",
    titleKey: "providerPresets.title",
    descriptionKey: "providerPresets.description",
    icon: Package,
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
    >
      <div className="grid gap-4 md:grid-cols-2">
        {ADMIN_ENTRY_CARDS.map(({ href, titleKey, descriptionKey, icon: Icon }) => (
          <Link key={href} href={href} className="block">
            <GlassCard
              padding="default"
              hover="lift"
              className="h-full min-h-[11rem] cursor-pointer"
            >
              <div className="flex h-full flex-col justify-between gap-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex size-12 items-center justify-center rounded-2xl bg-[var(--primary)]/10">
                    <Icon className="size-6 text-[var(--primary)]" />
                  </div>
                  <ArrowRight className="size-5 text-[var(--muted)]" />
                </div>

                <div className="space-y-2">
                  <h2 className="text-lg font-semibold text-[var(--foreground)]">
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
    </AdminPageShell>
  )
}
