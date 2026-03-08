import dynamic from "next/dynamic"
import { Cpu } from "lucide-react"
import { getTranslations, setRequestLocale } from "next-intl/server"
import { AdminPageShell, AdminSkeleton } from "@/components/admin"

const PageContent = dynamic(
  () => import("./page-content").then((mod) => ({ default: mod.PageContent })),
  {
    loading: () => (
      <div className="space-y-4">
        <AdminSkeleton variant="form" />
      </div>
    ),
  }
)

export default async function EmbeddingSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const tAdmin = await getTranslations({ locale, namespace: "admin" })

  return (
    <AdminPageShell
      title={tAdmin("embeddingSettings.title")}
      description={tAdmin("embeddingSettings.description")}
      icon={<Cpu />}
    >
      <PageContent />
    </AdminPageShell>
  )
}
