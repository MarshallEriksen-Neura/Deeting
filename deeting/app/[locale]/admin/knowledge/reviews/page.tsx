import { setRequestLocale, getTranslations } from "next-intl/server"
import { BookOpen, Search, Filter } from "lucide-react"

export default async function KnowledgeReviewsPage({
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
          <BookOpen className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold">{t("knowledgeReviews.title")}</h1>
          <p className="text-muted-foreground">{t("knowledgeReviews.description")}</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="text-2xl font-bold">24</div>
          <p className="text-sm text-muted-foreground">总待审</p>
        </div>
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="text-2xl font-bold text-blue-500">8</div>
          <p className="text-sm text-muted-foreground">今日新增</p>
        </div>
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="text-2xl font-bold text-green-500">156</div>
          <p className="text-sm text-muted-foreground">本月通过</p>
        </div>
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="text-2xl font-bold text-purple-500">92%</div>
          <p className="text-sm text-muted-foreground">通过率</p>
        </div>
      </div>

      {/* Review Queue */}
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="font-semibold">审核工作台</h2>
          <div className="flex gap-2">
            <button className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
              <Filter className="h-4 w-4" />
              {t("common.filter")}
            </button>
          </div>
        </div>
        <div className="p-6 text-center text-muted-foreground">
          {t("common.noData")}
        </div>
      </div>
    </div>
  )
}
