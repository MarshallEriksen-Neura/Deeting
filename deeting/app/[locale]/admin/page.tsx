import { setRequestLocale, getTranslations } from "next-intl/server"
import { LayoutDashboard, Users, Bot, Key, Activity } from "lucide-react"

export default async function AdminDashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations("admin")

  const stats = [
    {
      title: t("stats.totalUsers"),
      value: "1,234",
      icon: Users,
      change: "+12%",
      changeType: "positive" as const,
    },
    {
      title: t("stats.totalAssistants"),
      value: "56",
      icon: Bot,
      change: "+3",
      changeType: "positive" as const,
    },
    {
      title: t("stats.activeApiKeys"),
      value: "89",
      icon: Key,
      change: "-2",
      changeType: "negative" as const,
    },
    {
      title: t("stats.requestsToday"),
      value: "12.5K",
      icon: Activity,
      change: "+8%",
      changeType: "positive" as const,
    },
  ]

  return (
    <div className="flex-1 p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-primary/10">
          <LayoutDashboard className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold">{t("dashboard.title")}</h1>
          <p className="text-muted-foreground">{t("dashboard.description")}</p>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <div
            key={stat.title}
            className="rounded-xl border bg-card p-6 shadow-sm"
          >
            <div className="flex items-center justify-between">
              <stat.icon className="h-5 w-5 text-muted-foreground" />
              <span
                className={`text-sm font-medium ${
                  stat.changeType === "positive"
                    ? "text-green-600 dark:text-green-400"
                    : "text-red-600 dark:text-red-400"
                }`}
              >
                {stat.change}
              </span>
            </div>
            <div className="mt-4">
              <p className="text-2xl font-bold">{stat.value}</p>
              <p className="text-sm text-muted-foreground">{stat.title}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="text-lg font-semibold mb-4">{t("dashboard.quickActions")}</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <a
            href="/admin/assistant-reviews"
            className="flex items-center gap-3 p-4 rounded-lg border hover:bg-accent transition-colors"
          >
            <Bot className="h-5 w-5 text-primary" />
            <span>{t("dashboard.reviewAssistants")}</span>
          </a>
          <a
            href="/admin/users"
            className="flex items-center gap-3 p-4 rounded-lg border hover:bg-accent transition-colors"
          >
            <Users className="h-5 w-5 text-primary" />
            <span>{t("dashboard.manageUsers")}</span>
          </a>
          <a
            href="/admin/monitoring"
            className="flex items-center gap-3 p-4 rounded-lg border hover:bg-accent transition-colors"
          >
            <Activity className="h-5 w-5 text-primary" />
            <span>{t("dashboard.viewMonitoring")}</span>
          </a>
        </div>
      </div>
    </div>
  )
}
