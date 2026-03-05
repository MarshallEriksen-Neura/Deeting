import dynamic from "next/dynamic"
import { setRequestLocale } from "next-intl/server"
import { AdminPageSkeleton } from "./components/admin-page-skeleton"

const PageContent = dynamic(
  () => import("./page-content").then((mod) => ({ default: mod.PageContent })),
  { loading: () => <AdminPageSkeleton /> }
)

export default async function AdminDashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  return <PageContent />
}
