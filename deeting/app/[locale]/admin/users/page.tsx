import { Suspense } from "react"
import { setRequestLocale } from "next-intl/server"
import { PageContent } from "./page-content"
import { UsersPageSkeleton } from "./components/page-skeleton"

export default async function UserManagementPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  return (
    <Suspense fallback={<UsersPageSkeleton />}>
      <PageContent />
    </Suspense>
  )
}
