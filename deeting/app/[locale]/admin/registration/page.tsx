import dynamic from "next/dynamic"
import { setRequestLocale } from "next-intl/server"
import { PageLoading } from "../components/page-loading"

const PageContent = dynamic(
  () => import("./page-content").then((mod) => ({ default: mod.PageContent })),
  { loading: () => <PageLoading /> }
)

export default async function RegistrationPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  return <PageContent />
}
