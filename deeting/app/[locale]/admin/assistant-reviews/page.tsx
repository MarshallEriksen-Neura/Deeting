import { setRequestLocale, getTranslations } from "next-intl/server"
import { CheckSquare, Search, Filter } from "lucide-react"

export default async function AssistantReviewsPage({
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
          <CheckSquare className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold">{t("assistantReviews.title")}</h1>
          <p className="text-muted-foreground">{t("assistantReviews.description")}</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="text-2xl font-bold text-yellow-500">5</div>
          <p className="text-sm text-muted-foreground">待审核</p>
        </div>
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="text-2xl font-bold text-green-500">12</div>
          <p className="text-sm text-muted-foreground">已通过</p>
        </div>
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="text-2xl font-bold text-red-500">3</div>
          <p className="text-sm text-muted-foreground">已拒绝</p>
        </div>
      </div>

      {/* Review Queue */}
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <div className="p-4 border-b">
          <h2 className="font-semibold">审核队列</h2>
        </div>
        <div className="p-6 text-center text-muted-foreground">
          {t("common.noData")}
        </div>
      </div>
    </div>
  )
}
