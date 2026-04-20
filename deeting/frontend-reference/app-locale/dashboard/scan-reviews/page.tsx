import dynamic from "next/dynamic"
import { Shield } from "lucide-react"
import { getTranslations, setRequestLocale } from "next-intl/server"
import { AdminPageShell, AdminSkeleton } from "@/components/admin"

const PageContent = dynamic(
  () => import("./page-content").then((mod) => ({ default: mod.PageContent })),
  {
    loading: () => (
      <div className="space-y-4">
        <AdminSkeleton variant="table" rows={6} />
      </div>
    ),
  }
)

export default async function DashboardScanReviewsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const tDashboard = await getTranslations({ locale, namespace: "dashboard" })

  return (
    <AdminPageShell
      title={tDashboard("scanReviews.title")}
      description={tDashboard("scanReviews.description")}
      icon={<Shield />}
    >
      <PageContent />
    </AdminPageShell>
  )
}