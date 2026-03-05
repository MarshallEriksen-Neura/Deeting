import dynamic from "next/dynamic"
import { setRequestLocale } from "next-intl/server"
import { UsersPageSkeleton } from "./components/page-skeleton"

const PageContent = dynamic(
  () => import("./page-content").then((mod) => ({ default: mod.PageContent })),
  { loading: () => <UsersPageSkeleton /> }
)

export default async function UserManagementPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  return <PageContent />
}
