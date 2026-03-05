import dynamic from "next/dynamic"
import { Eye } from "lucide-react"
import { getTranslations, setRequestLocale } from "next-intl/server"
import { AdminPageShell, AdminSkeleton } from "@/components/admin"

const PageContent = dynamic(
  () => import("./page-content").then((mod) => ({ default: mod.PageContent })),
  {
    loading: () => (
      <div className="space-y-4">
        <AdminSkeleton variant="stats" columns={4} />
        <AdminSkeleton variant="table" rows={8} />
      </div>
    ),
  }
)

export default async function AdminMonitoringPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const tAdmin = await getTranslations({ locale, namespace: "admin" })

  return (
    <AdminPageShell
      title={tAdmin("monitoring.title")}
      description={tAdmin("monitoring.description")}
      icon={Eye}
    >
      <PageContent />
    </AdminPageShell>
  )
}
