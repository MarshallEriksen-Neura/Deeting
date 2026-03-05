import dynamic from "next/dynamic"
import { GitBranch } from "lucide-react"
import { getTranslations, setRequestLocale } from "next-intl/server"
import { AdminPageShell, AdminSkeleton } from "@/components/admin"

const PageContent = dynamic(
  () => import("./page-content").then((mod) => ({ default: mod.PageContent })),
  {
    loading: () => (
      <div className="space-y-4">
        <AdminSkeleton variant="stats" columns={4} />
        <AdminSkeleton variant="table" rows={6} />
      </div>
    ),
  }
)

export default async function RoutingMabPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const tRouting = await getTranslations({
    locale,
    namespace: "monitoring.routing",
  })

  return (
    <AdminPageShell
      title={tRouting("pageTitle")}
      description={tRouting("pageDescription")}
      icon={GitBranch}
    >
      <PageContent />
    </AdminPageShell>
  )
}
