import dynamic from "next/dynamic"
import { Bell } from "lucide-react"
import { getTranslations, setRequestLocale } from "next-intl/server"
import { AdminPageShell, AdminSkeleton } from "@/components/admin"

const PageContent = dynamic(
  () => import("./page-content").then((mod) => ({ default: mod.PageContent })),
  {
    loading: () => (
      <div className="space-y-4">
        <AdminSkeleton variant="form" />
        <AdminSkeleton variant="table" rows={6} />
      </div>
    ),
  }
)

export default async function NotificationsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const tAdmin = await getTranslations({ locale, namespace: "admin" })
  const tNotifications = await getTranslations({
    locale,
    namespace: "admin.notificationsPage",
  })

  return (
    <AdminPageShell
      title={tAdmin("notifications.title")}
      description={tNotifications("description")}
      icon={Bell}
    >
      <PageContent />
    </AdminPageShell>
  )
}
