import { setRequestLocale, getTranslations } from "next-intl/server"
import { Eye, Activity, Cpu, HardDrive } from "lucide-react"

export default async function AdminMonitoringPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations("admin")

  return (
    <div className="flex-1 p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-primary/10">
          <Eye className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold">{t("monitoring.title")}</h1>
          <p className="text-muted-foreground">{t("monitoring.description")}</p>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="h-5 w-5 text-green-500" />
            <span className="font-medium">API 健康状态</span>
          </div>
          <div className="text-3xl font-bold text-green-500">正常</div>
          <p className="text-sm text-muted-foreground mt-1">延迟: 45ms</p>
        </div>

        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Cpu className="h-5 w-5 text-blue-500" />
            <span className="font-medium">CPU 使用率</span>
          </div>
          <div className="text-3xl font-bold">32%</div>
          <div className="w-full bg-muted rounded-full h-2 mt-2">
            <div className="bg-blue-500 h-2 rounded-full" style={{ width: "32%" }} />
          </div>
        </div>

        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <HardDrive className="h-5 w-5 text-purple-500" />
            <span className="font-medium">内存使用</span>
          </div>
          <div className="text-3xl font-bold">4.2 GB</div>
          <p className="text-sm text-muted-foreground mt-1">/ 8 GB</p>
        </div>
      </div>

      {/* Placeholder for charts */}
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="text-lg font-semibold mb-4">请求趋势</h2>
        <div className="h-64 flex items-center justify-center text-muted-foreground border-2 border-dashed rounded-lg">
          图表区域 - 待接入实际监控数据
        </div>
      </div>
    </div>
  )
}
