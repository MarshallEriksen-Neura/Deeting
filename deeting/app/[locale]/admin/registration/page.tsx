import { setRequestLocale, getTranslations } from "next-intl/server"
import { Ticket, Search, Filter, Plus } from "lucide-react"

export default async function RegistrationPage({
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
            <Ticket className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold">{t("registration.title")}</h1>
            <p className="text-muted-foreground">{t("registration.description")}</p>
          </div>
        </div>
        <button className="inline-flex items-center gap-2 justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          <Plus className="h-4 w-4" />
          生成邀请码
        </button>
      </div>

      {/* Registration Settings */}
      <div className="rounded-xl border bg-card p-6 shadow-sm space-y-4">
        <h2 className="font-semibold">注册设置</h2>
        <div className="flex items-center justify-between py-3 border-b">
          <div>
            <p className="font-medium">开放注册</p>
            <p className="text-sm text-muted-foreground">允许新用户自由注册</p>
          </div>
          <button className="relative inline-flex h-6 w-11 items-center rounded-full bg-muted transition-colors">
            <span className="inline-block h-4 w-4 transform rounded-full bg-white shadow-lg transition-transform translate-x-1" />
          </button>
        </div>
        <div className="flex items-center justify-between py-3">
          <div>
            <p className="font-medium">邀请码注册</p>
            <p className="text-sm text-muted-foreground">需要邀请码才能注册</p>
          </div>
          <button className="relative inline-flex h-6 w-11 items-center rounded-full bg-primary transition-colors">
            <span className="inline-block h-4 w-4 transform rounded-full bg-white shadow-lg transition-transform translate-x-6" />
          </button>
        </div>
      </div>

      {/* Invite Codes */}
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <div className="p-4 border-b">
          <h2 className="font-semibold">邀请码列表</h2>
        </div>
        <table className="w-full">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-6 py-3 text-left text-sm font-medium">邀请码</th>
              <th className="px-6 py-3 text-left text-sm font-medium">使用次数</th>
              <th className="px-6 py-3 text-left text-sm font-medium">剩余次数</th>
              <th className="px-6 py-3 text-left text-sm font-medium">过期时间</th>
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
