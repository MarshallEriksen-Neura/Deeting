import { setRequestLocale, getTranslations } from "next-intl/server"
import { Bell, Search, Filter, Plus } from "lucide-react"

export default async function AdminNotificationsPage({
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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Bell className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold">{t("notifications.title")}</h1>
            <p className="text-muted-foreground">{t("notifications.description")}</p>
          </div>
        </div>
        <button className="inline-flex items-center gap-2 justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          <Plus className="h-4 w-4" />
          发送通知
        </button>
      </div>

      {/* Search */}
      <div className="flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder={t("common.search")}
            className="w-full rounded-md border bg-background px-10 py-2 text-sm"
          />
        </div>
        <button className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm">
          <Filter className="h-4 w-4" />
          {t("common.filter")}
        </button>
      </div>

      {/* Notifications List */}
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <table className="w-full">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-6 py-3 text-left text-sm font-medium">标题</th>
              <th className="px-6 py-3 text-left text-sm font-medium">类型</th>
              <th className="px-6 py-3 text-left text-sm font-medium">目标</th>
              <th className="px-6 py-3 text-left text-sm font-medium">发送时间</th>
              <th className="px-6 py-3 text-left text-sm font-medium">状态</th>
              <th className="px-6 py-3 text-right text-sm font-medium">{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            <tr>
              <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">
                {t("common.noData")}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
