import { FileSearch } from "lucide-react"
import { getTranslations, setRequestLocale } from "next-intl/server"

import { PageHeader } from "@/components/models/page-header"
import { ScanReviewsClient } from "./components/scan-reviews-client"

export default async function ScanReviewsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const tDashboard = await getTranslations({ locale, namespace: "dashboard" })

  return (
    <main className="h-full min-h-0 overflow-y-auto px-5 py-5 md:px-7 md:py-6">
      <div className="mx-auto flex w-full max-w-[1480px] flex-col">
        <PageHeader
          title={tDashboard("scanReviews.title")}
          description={tDashboard("scanReviews.description")}
          icon={FileSearch}
        />
        <ScanReviewsClient />
      </div>
    </main>
  )
}