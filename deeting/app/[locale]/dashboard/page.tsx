import dynamic from "next/dynamic"
import { getTranslations, setRequestLocale } from "next-intl/server"

import { Container } from "@/components/ui/container"
import { Skeleton } from "@/components/ui/skeleton"

const DashboardContent = dynamic(
  () => import("./dashboard-client").then((mod) => mod.DashboardClient),
  { loading: () => <DashboardContentSkeleton /> }
)

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations({ locale, namespace: "dashboard" })

  return (
    <Container
      as="main"
      gutter="md"
      size="full"
      className="py-6 md:py-8 !mx-0 !max-w-none"
    >
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[var(--foreground)] md:text-3xl">
          {t("title")}
        </h1>
        <p className="mt-1 text-[var(--muted)]">{t("description")}</p>
      </div>

      <DashboardContent />
    </Container>
  )
}

function DashboardContentSkeleton() {
  return (
    <>
      <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <DashboardPanelSkeleton key={index} className="h-[132px]" />
        ))}
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <DashboardPanelSkeleton className="h-[360px]" />
        </div>

        <div className="lg:col-span-1">
          <DashboardPanelSkeleton className="h-[360px]" />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <DashboardPanelSkeleton className="h-[320px]" />
        <DashboardPanelSkeleton className="h-[320px]" />
      </div>
    </>
  )
}

function DashboardPanelSkeleton({ className }: { className?: string }) {
  return (
    <div className={`rounded-3xl border border-border/60 bg-card/80 p-6 ${className ?? ""}`}>
      <div className="space-y-4">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-24 w-full" />
      </div>
    </div>
  )
}
