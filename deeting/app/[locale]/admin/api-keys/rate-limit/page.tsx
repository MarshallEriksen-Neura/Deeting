import { setRequestLocale, getTranslations } from "next-intl/server"
import { Gauge, Search, Filter, Plus } from "lucide-react"

export default async function ApiRateLimitPage({
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
            <Gauge className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold">{t("rateLimit.title")}</h1>
            <p className="text-muted-foreground">{t("rateLimit.description")}</p>
          </div>
        </div>
        <button className="inline-flex items-center gap-2 justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          <Plus className="h-4 w-4" />
          添加规则
        </button>
      </div>

      {/* Rate Limit Rules */}
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <div className="p-4 border-b">
          <h2 className="font-semibold">限流规则</h2>
        </div>
        <table className="w-full">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-6 py-3 text-left text-sm font-medium">API Key</th>
              <th className="px-6 py-3 text-left text-sm font-medium">RPM 限制</th>
              <th className="px-6 py-3 text-left text-sm font-medium">TPM 限制</th>
              <th className="px-6 py-3 text-left text-sm font-medium">当前用量</th>
              <th className="px-6 py-3 text-right text-sm font-medium">{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            <tr>
              <td colSpan={5} className="px-6 py-12 text-center text-muted-foreground">
                {t("common.noData")}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
