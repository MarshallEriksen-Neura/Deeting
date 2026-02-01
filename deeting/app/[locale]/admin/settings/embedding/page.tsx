import { setRequestLocale, getTranslations } from "next-intl/server"
import { Cpu } from "lucide-react"

export default async function EmbeddingSettingsPage({
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
          <Cpu className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold">{t("embeddingSettings.title")}</h1>
          <p className="text-muted-foreground">{t("embeddingSettings.description")}</p>
        </div>
      </div>

      {/* Settings */}
      <div className="rounded-xl border bg-card p-6 shadow-sm space-y-6">
        <h2 className="font-semibold">Embedding 配置</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">默认 Embedding 模型</label>
            <select className="w-full rounded-md border bg-background px-3 py-2 text-sm">
              <option>text-embedding-3-small</option>
              <option>text-embedding-3-large</option>
              <option>text-embedding-ada-002</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">向量维度</label>
            <input
              type="number"
              defaultValue={1536}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">批处理大小</label>
            <input
              type="number"
              defaultValue={100}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <button className="rounded-md border px-4 py-2 text-sm">
            {t("common.cancel")}
          </button>
          <button className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            {t("common.save")}
          </button>
        </div>
      </div>
    </div>
  )
}
