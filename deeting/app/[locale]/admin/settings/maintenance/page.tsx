import dynamic from "next/dynamic"
import { Settings } from "lucide-react"
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

export default async function MaintenanceSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const tAdmin = await getTranslations({ locale, namespace: "admin" })

  return (
    <AdminPageShell
      title={tAdmin("maintenanceSettings.title")}
      description={tAdmin("maintenanceSettings.description")}
      icon={<Settings />}
    >
      <PageContent />
    </AdminPageShell>
  )
}