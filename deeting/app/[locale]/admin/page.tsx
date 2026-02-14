import { Suspense } from "react"
import { setRequestLocale } from "next-intl/server"
import { PageContent } from "./page-content"
import { AdminPageSkeleton } from "./components/admin-page-skeleton"

export default async function AdminDashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  return (
    <Suspense fallback={<AdminPageSkeleton />}>
      <PageContent />
    </Suspense>
  )
}
