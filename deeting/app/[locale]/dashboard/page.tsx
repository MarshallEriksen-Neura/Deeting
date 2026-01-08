import { useTranslations } from "next-intl"
import { setRequestLocale } from "next-intl/server"
import { Activity, Zap, Shield, Settings, TrendingUp, Clock, Server } from "lucide-react"

import {
  GlassCard,
  GlassCardHeader,
  GlassCardTitle,
  GlassCardDescription,
  GlassCardContent,
  GlassStatCard,
} from "@/components/ui/glass-card"
import { GlassButton } from "@/components/ui/glass-button"
import { Container } from "@/components/ui/container"

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  return <DashboardContent />
}

function DashboardContent() {
  const t = useTranslations("dashboard")
  const tStats = useTranslations("stats")

  return (
    <Container as="main" className="py-6 md:py-8" gutter="md">
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[var(--foreground)] md:text-3xl">
          {t("title")}
        </h1>
        <p className="mt-1 text-[var(--muted)]">{t("description")}</p>
      </div>

      {/* Stats Grid */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <GlassStatCard
          label={tStats("totalRoutes")}
          value="128"
          trend={{ value: 12, isPositive: true }}
          icon={<Activity className="size-5" />}
          className="animate-glass-card-in stagger-1"
        />
        <GlassStatCard
          label={tStats("activeServices")}
          value="24"
          trend={{ value: 8, isPositive: true }}
          icon={<Zap className="size-5" />}
          theme="primary"
          className="animate-glass-card-in stagger-2"
        />
        <GlassStatCard
          label={tStats("securityRules")}
          value="56"
          trend={{ value: 3, isPositive: false }}
          icon={<Shield className="size-5" />}
          theme="teal"
          className="animate-glass-card-in stagger-3"
        />
        <GlassStatCard
          label={tStats("activePlugins")}
          value="12"
          icon={<Settings className="size-5" />}
          className="animate-glass-card-in stagger-4"
        />
      </div>

      {/* Content Grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Recent Activity */}
        <GlassCard
          className="lg:col-span-2 animate-glass-card-in stagger-5"
          padding="none"
        >
          <GlassCardHeader className="p-6 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <GlassCardTitle>{t("recentActivity")}</GlassCardTitle>
                <GlassCardDescription>
                  {t("recentActivityDesc")}
                </GlassCardDescription>
              </div>
              <GlassButton variant="ghost" size="sm">
                {t("viewAll")}
              </GlassButton>
            </div>
          </GlassCardHeader>
          <GlassCardContent className="px-6 pb-6">
            <div className="space-y-4">
              {[
                {
                  icon: TrendingUp,
                  title: "Route /api/v1/users updated",
                  time: "2 minutes ago",
                  color: "text-emerald-400",
                },
                {
                  icon: Server,
                  title: "New service 'payment-gateway' deployed",
                  time: "15 minutes ago",
                  color: "text-[var(--primary)]",
                },
                {
                  icon: Shield,
                  title: "Security rule updated for /admin/*",
                  time: "1 hour ago",
                  color: "text-amber-400",
                },
                {
                  icon: Clock,
                  title: "Rate limiting enabled for /api/v2/*",
                  time: "3 hours ago",
                  color: "text-[var(--teal-accent)]",
                },
              ].map((item, index) => (
                <div
                  key={index}
                  className="flex items-center gap-4 rounded-xl p-3 transition-colors hover:bg-[var(--foreground)]/5"
                >
                  <div
                    className={`flex size-10 items-center justify-center rounded-xl bg-[var(--foreground)]/5 ${item.color}`}
                  >
                    <item.icon className="size-5" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-[var(--foreground)]">
                      {item.title}
                    </p>
                    <p className="text-xs text-[var(--muted)]">{item.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </GlassCardContent>
        </GlassCard>

        {/* Quick Actions */}
        <GlassCard className="animate-glass-card-in stagger-6">
          <GlassCardHeader>
            <GlassCardTitle>{t("quickActions")}</GlassCardTitle>
            <GlassCardDescription>{t("quickActionsDesc")}</GlassCardDescription>
          </GlassCardHeader>
          <GlassCardContent>
            <div className="flex flex-col gap-3">
              <GlassButton className="w-full justify-start">
                <Activity className="size-4" />
                {t("createRoute")}
              </GlassButton>
              <GlassButton variant="secondary" className="w-full justify-start">
                <Server className="size-4" />
                {t("addService")}
              </GlassButton>
              <GlassButton variant="outline" className="w-full justify-start">
                <Shield className="size-4" />
                {t("configureRules")}
              </GlassButton>
              <GlassButton variant="ghost" className="w-full justify-start">
                <Settings className="size-4" />
                {t("managePlugins")}
              </GlassButton>
            </div>
          </GlassCardContent>
        </GlassCard>
      </div>
    </Container>
  )
}
