import { setRequestLocale, getTranslations } from "next-intl/server"
import { AdminMemoryClient } from "./components/admin-memory-client"

export default async function AdminMemoryPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations({ locale, namespace: "admin" })

  return (
    <div className="h-full flex flex-col transition-colors duration-300 bg-gray-50 dark:bg-[#05050A]">
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        <div className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-center">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-transparent dark:bg-clip-text dark:bg-gradient-to-r dark:from-blue-400 dark:to-purple-400">
              {t("systemMemory.title")}
            </h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
              {t("systemMemory.description")}
            </p>
          </div>
        </div>

        <AdminMemoryClient />
      </div>
    </div>
  )
}
