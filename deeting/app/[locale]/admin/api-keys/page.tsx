import { setRequestLocale, getTranslations } from "next-intl/server"
import { Key, Search, Filter, Plus } from "lucide-react"

export default async function AdminApiKeysPage({
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
            <Key className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold">{t("apiKeys.title")}</h1>
            <p className="text-muted-foreground">{t("apiKeys.description")}</p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="text-2xl font-bold">89</div>
          <p className="text-sm text-muted-foreground">总 API Key</p>
        </div>
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="text-2xl font-bold text-green-500">76</div>
          <p className="text-sm text-muted-foreground">活跃</p>
        </div>
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="text-2xl font-bold text-red-500">13</div>
          <p className="text-sm text-muted-foreground">已禁用</p>
        </div>
      </div>

      {/* Search and Filter */}
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

      {/* Table */}
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <table className="w-full">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-6 py-3 text-left text-sm font-medium">名称</th>
              <th className="px-6 py-3 text-left text-sm font-medium">所属用户</th>
              <th className="px-6 py-3 text-left text-sm font-medium">状态</th>
              <th className="px-6 py-3 text-left text-sm font-medium">用量</th>
              <th className="px-6 py-3 text-left text-sm font-medium">创建时间</th>
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
